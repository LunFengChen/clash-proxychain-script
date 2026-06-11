// Clash Verge global profile script.
//
// Chain path:
// local -> Chain-Front -> Hop1 -> Hop2 -> Landing -> target
//
// Add new chains only in CHAINS. A single hop keeps the old behavior:
// Chain-Front -> US-Chicago-Chain.
//
// A multi-hop chain is configured by adding more items to hops. For example:
// {
//   name: "US-Chicago-via-NewYork",
//   chainName: "US-Chicago-via-NewYork-Chain",
//   chainGroup: "Chain-US-Chicago-via-NewYork",
//   hops: [
//     { name: "US-NewYork-Relay", proxy: { type: "socks5", server: "x.x.x.x", port: 443, username: "user", password: "pass", udp: true } },
//     { name: "US-Chicago", proxy: { type: "socks5", server: "x.x.x.x", port: 443, username: "user", password: "pass", udp: true } },
//   ],
// },

function main(config, profileName) {
  const CHAINS = [
    {
      name: "US-Chicago",
      chainName: "US-Chicago-Chain",
      chainGroup: "Chain-US-Chicago",
      hops: [
        {
          name: "US-Chicago",
          proxy: {
            type: "socks5",
            server: "YOUR_LANDING_SERVER",
            port: 443,
            username: "YOUR_USERNAME",
            password: "YOUR_PASSWORD",
            udp: true,

            // If the SOCKS5 server requires TLS, enable these two fields.
            // tls: true,
            // "skip-cert-verify": true,
          },
        },
      ],
    },
  ];

  const GROUPS = {
    default: "Default",
    front: "Chain-Front",
    domestic: "Domestic-Sites",
    originalSelect: "节点选择",
    originalAuto: "自动选择",
    download: "磁力下载",
  };

  const DIRECT_PROCESSES = [
    "wechat",
    "WeChat",
    "WeChat.exe",
    "WeChatAppEx",
    "wxocr",
    "wxplayer",
    "wxutility",
    "qq",
    "QQ",
  ];

  const DIRECT_DOMAINS = [
    "weixin.qq.com",
    "wx.qq.com",
    "mp.weixin.qq.com",
    "file.wx.qq.com",
    "res.wx.qq.com",
    "support.weixin.qq.com",
    "short.weixin.qq.com",
    "long.weixin.qq.com",
    "szextshort.weixin.qq.com",
    "dns.weixin.qq.com",
    "qpic.cn",
    "qlogo.cn",
    "gtimg.cn",
    "gtimg.com",
    "qq.com",
    "tencent.com",
  ];

  const DIRECT_IP_RANGES = [
    "112.53.48.0/20",
    "120.232.51.0/24",
    "120.233.109.0/24",
    "120.204.0.0/24",
  ];

  const LEGACY_PROXY_NAMES = new Set(["SOCKS5-前置", "SOCKS5-直连", "SOCKS5-落地-链式"]);
  const LEGACY_GROUP_NAMES = new Set(["前置代理", "链式代理", "国内网站", "默认代理", "CN-Sites"]);

  const normalizedChains = normalizeChains(CHAINS);
  const chainNames = normalizedChains.map((item) => item.chainName);
  const chainGroups = normalizedChains.map((item) => item.chainGroup);
  const directProxyNames = unique(
    normalizedChains.flatMap((chain) => chain.hops.map((hop) => hop.name)),
  );
  const chainProxyNames = unique(
    normalizedChains.flatMap((chain) => buildChainProxyNames(chain)),
  );
  const generatedProxyNames = new Set([...directProxyNames, ...chainProxyNames, ...LEGACY_PROXY_NAMES]);
  const generatedGroupNames = new Set([
    GROUPS.default,
    GROUPS.front,
    GROUPS.domestic,
    ...chainGroups,
    ...LEGACY_GROUP_NAMES,
  ]);

  config.proxies = buildProxies(config.proxies, normalizedChains, generatedProxyNames, GROUPS.front);

  config["proxy-groups"] = Array.isArray(config["proxy-groups"])
    ? config["proxy-groups"].filter((group) => !generatedGroupNames.has(group.name))
    : [];

  addManagedGroups(config, normalizedChains, GROUPS, chainGroups, chainNames, directProxyNames);
  addChainChoiceToServiceGroups(config, GROUPS, generatedGroupNames, chainGroups[0]);
  tuneTunForDirectApps(config, DIRECT_IP_RANGES);
  prependDirectRules(config, DIRECT_PROCESSES, DIRECT_DOMAINS, DIRECT_IP_RANGES);
  rewriteDomesticRules(config, GROUPS.domestic, DIRECT_DOMAINS, DIRECT_IP_RANGES);
  setDefaultRule(config, GROUPS.default);

  return config;
}

function normalizeChains(chains) {
  return chains
    .map((chain) => {
      const hops = Array.isArray(chain.hops)
        ? chain.hops
        : [{ name: chain.name, proxy: chain.proxy }];

      return {
        name: chain.name,
        chainName: chain.chainName || `${chain.name}-Chain`,
        chainGroup: chain.chainGroup || `Chain-${chain.name}`,
        hops: hops.filter((hop) => hop && hop.name && hop.proxy),
      };
    })
    .filter((chain) => chain.hops.length > 0);
}

function buildChainProxyNames(chain) {
  return chain.hops.map((hop, index) => {
    const isLanding = index === chain.hops.length - 1;
    if (isLanding) return chain.chainName;
    return `${chain.name}-Hop${index + 1}-${hop.name}`;
  });
}

function buildProxies(existingProxies, chains, generatedProxyNames, frontGroupName) {
  const keptProxies = (Array.isArray(existingProxies) ? existingProxies : []).filter((proxy) => {
    if (!proxy || !proxy.name) return false;
    if (generatedProxyNames.has(proxy.name)) return false;
    return !proxy.name.endsWith("-链式");
  });

  const directProxyMap = new Map();
  for (const chain of chains) {
    for (const hop of chain.hops) {
      directProxyMap.set(hop.name, {
        name: hop.name,
        ...hop.proxy,
      });
    }
  }

  const chainProxies = chains.flatMap((chain) => {
    let dialerProxy = frontGroupName;
    const chainProxyNames = buildChainProxyNames(chain);

    return chain.hops.map((hop, index) => {
      const proxyName = chainProxyNames[index];
      const proxy = {
        name: proxyName,
        ...hop.proxy,
        "dialer-proxy": dialerProxy,
      };
      dialerProxy = proxyName;
      return proxy;
    });
  });

  return [...directProxyMap.values(), ...chainProxies, ...keptProxies];
}

function addManagedGroups(config, chains, groups, chainGroups, chainNames, directProxyNames) {
  upsertGroup(config, {
    name: groups.domestic,
    type: "select",
    proxies: ["DIRECT", ...directProxyNames, ...chainNames],
  });

  upsertGroup(config, {
    name: groups.front,
    type: "select",
    proxies: [groups.originalSelect, groups.originalAuto, "DIRECT"],
  });

  for (const chain of chains) {
    upsertGroup(config, {
      name: chain.chainGroup,
      type: "select",
      proxies: [chain.chainName, ...chain.hops.map((hop) => hop.name), "DIRECT"],
    });
  }

  upsertGroup(config, {
    name: groups.default,
    type: "select",
    proxies: [...chainGroups, ...chainNames, ...directProxyNames, groups.originalSelect, "DIRECT"],
  });
}

function addChainChoiceToServiceGroups(config, groups, generatedGroupNames, preferredChainGroup) {
  const skipGroups = new Set([
    ...generatedGroupNames,
    groups.originalSelect,
    groups.originalAuto,
    groups.download,
  ]);

  for (const group of config["proxy-groups"]) {
    if (!group || group.type !== "select" || !Array.isArray(group.proxies)) continue;
    if (skipGroups.has(group.name)) continue;

    group.proxies = group.proxies.filter((name) => !generatedGroupNames.has(name));
    group.proxies = [preferredChainGroup, ...group.proxies];
  }
}

function tuneTunForDirectApps(config, directIpRanges) {
  config["find-process-mode"] = "always";
  config.tun = config.tun || {};

  const existing = Array.isArray(config.tun["route-exclude-address"])
    ? config.tun["route-exclude-address"]
    : [];

  config.tun["route-exclude-address"] = unique([...existing, ...directIpRanges]);
}

function prependDirectRules(config, processNames, domainSuffixes, ipRanges) {
  const directRules = [
    ...processNames.map((name) => `PROCESS-NAME,${name},DIRECT`),
    ...domainSuffixes.map((domain) => `DOMAIN-SUFFIX,${domain},DIRECT`),
    ...ipRanges.map((range) => `IP-CIDR,${range},DIRECT,no-resolve`),
  ];

  const ruleSet = new Set(directRules);
  const existingRules = Array.isArray(config.rules) ? config.rules : [];

  config.rules = [
    ...directRules,
    ...existingRules.filter((rule) => typeof rule !== "string" || !ruleSet.has(rule)),
  ];
}

function rewriteDomesticRules(config, domesticGroupName, directDomains, directIpRanges) {
  const protectedRules = new Set([
    ...directDomains.map((domain) => `DOMAIN-SUFFIX,${domain},DIRECT`),
    ...directIpRanges.map((range) => `IP-CIDR,${range},DIRECT,no-resolve`),
  ]);

  config.rules = (Array.isArray(config.rules) ? config.rules : []).map((rule) => {
    if (typeof rule !== "string") return rule;
    if (protectedRules.has(rule)) return rule;
    if (shouldKeepDirect(rule)) return rule;

    const parts = rule.split(",");
    const type = (parts[0] || "").trim().toUpperCase();
    const target = (parts[1] || "").trim().toUpperCase();
    const policy = (parts[2] || "").trim().toUpperCase();

    if (policy !== "DIRECT") return rule;

    if (type === "GEOIP" && target === "CN") {
      parts[2] = domesticGroupName;
      return parts.join(",");
    }

    if (type === "DOMAIN-SUFFIX" && target === "CN") {
      parts[2] = domesticGroupName;
      return parts.join(",");
    }

    if (["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD"].includes(type)) {
      parts[2] = domesticGroupName;
      return parts.join(",");
    }

    return rule;
  });
}

function setDefaultRule(config, defaultGroupName) {
  config.rules = (Array.isArray(config.rules) ? config.rules : []).filter((rule) => {
    return !(typeof rule === "string" && rule.startsWith("MATCH,"));
  });
  config.rules.push(`MATCH,${defaultGroupName}`);
}

function upsertGroup(config, group) {
  const groups = config["proxy-groups"];
  const index = groups.findIndex((item) => item.name === group.name);

  if (index >= 0) {
    groups[index] = {
      ...groups[index],
      ...group,
    };
  } else {
    groups.unshift(group);
  }
}

function shouldKeepDirect(rule) {
  const parts = rule.split(",");
  const type = (parts[0] || "").trim().toUpperCase();
  const target = (parts[1] || "").trim().toLowerCase();

  if (type === "PROCESS-NAME") return true;
  if (type === "GEOIP" && target === "lan") return true;
  if (type === "DOMAIN-SUFFIX" && target === "local") return true;
  if (target === "mojie.me") return true;
  if (target === "local.adguard.org" || target === "injections.adguard.org") return true;
  if (target.startsWith("127.") || target.startsWith("10.") || target.startsWith("192.168.")) return true;
  if (target === "172.16.0.0/12" || target === "100.64.0.0/10" || target === "224.0.0.0/4") return true;
  if (target === "fe80::/10") return true;

  return false;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
