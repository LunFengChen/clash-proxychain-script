// Clash Verge Rev global script: simple domestic/foreign split with optional proxy chains.
//
// User model:
//   - Process overrides first, for special apps such as WeChat/QQ.
//   - LAN/local traffic stays DIRECT.
//   - China IP / .cn domains go to Domestic-Sites.
//   - Everything else goes to Foreign-Sites.
//
// Only edit USER_CONFIG in normal use.

const USER_CONFIG = {
  // 1) Define your available chained landing proxies.
  //
  // Chain path:
  //   local app -> Chain-Front -> hop1 -> hop2 -> ... -> target
  //
  // A single hop means:
  //   local app -> Chain-Front -> US-Chicago -> target
  chains: [
    {
      id: "US",
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
  ],

  // 2) Name the groups shown in Clash Verge Rev.
  groups: {
    front: "Chain-Front",
    domestic: "Domestic-Sites",
    foreign: "Foreign-Sites",
    default: "Default",

    // These are usually provided by your subscription.
    originalSelect: "节点选择",
    originalAuto: "自动选择",
  },

  // 3) Choose what each traffic bucket can select in the GUI.
  //
  // Supported tokens:
  //   DIRECT    -> direct connection
  //   US        -> the chain whose id/name is US / US-Chicago
  //   DOMESTIC  -> Domestic-Sites
  //   FOREIGN   -> Foreign-Sites
  //   Any other string is used as a raw Clash policy/group name.
  //
  // Default behavior below:
  //   - Domestic-Sites: user can choose DIRECT or the US chain.
  //   - Foreign-Sites: default uses the US chain, DIRECT is kept as emergency fallback.
  domesticChoices: ["DIRECT", "US"],
  foreignChoices: ["US", "DIRECT"],

  // 4) Optional process overrides. These rules are evaluated before IP rules.
  //
  // Use this for apps whose traffic is hard to classify by domain/IP or whose login/media
  // behavior breaks under TUN/proxy. Keep this list short and understandable.
  processRules: [
    {
      note: "WeChat / QQ direct by default",
      policy: "DIRECT",
      names: [
        "wechat",
        "WeChat",
        "WeChat.exe",
        "WeChatAppEx",
        "wxocr",
        "wxplayer",
        "wxutility",
        "qq",
        "QQ",
      ],
    },

    // Examples:
    // { note: "Telegram always foreign", policy: "FOREIGN", names: ["Telegram", "telegram-desktop"] },
    // { note: "A browser always domestic", policy: "DOMESTIC", names: ["chrome"] },
    // { note: "Force one app to one raw group", policy: "Chain-US-Chicago", names: ["my-app"] },
  ],

  // 5) Optional direct IP ranges for special apps/networks.
  // Usually leave this empty. Put CIDR strings here only after logs prove they are needed.
  directIpRanges: [],

  // 6) Keep only these original subscription groups in the GUI.
  // The script adds its own Domestic/Foreign/Chain groups, so hiding vendor service groups
  // makes the UI easier to understand. Add names here if you still want to see them.
  keepOriginalGroups: [],
};

function main(config, profileName) {
  const settings = normalizeUserConfig(USER_CONFIG);
  const chains = normalizeChains(settings.chains);
  const chainGroups = chains.map((item) => item.chainGroup);
  const directProxyNames = unique(chains.flatMap((chain) => chain.hops.map((hop) => hop.name)));
  const chainProxyNames = unique(chains.flatMap((chain) => buildChainProxyNames(chain)));

  const generatedProxyNames = new Set([
    ...directProxyNames,
    ...chainProxyNames,
    "SOCKS5-前置",
    "SOCKS5-直连",
    "SOCKS5-落地-链式",
  ]);

  config.proxies = buildProxies(config.proxies, chains, generatedProxyNames, settings.groups.front);
  config["proxy-groups"] = keepOnlyUsefulGroups(config["proxy-groups"], settings);

  addManagedGroups(config, chains, settings);
  rebuildRules(config, settings, chains);

  return config;
}

function normalizeUserConfig(input) {
  const groups = {
    front: "Chain-Front",
    domestic: "Domestic-Sites",
    foreign: "Foreign-Sites",
    default: "Default",
    originalSelect: "节点选择",
    originalAuto: "自动选择",
    ...(input.groups || {}),
  };

  return {
    ...input,
    groups,
    chains: Array.isArray(input.chains) ? input.chains : [],
    domesticChoices: Array.isArray(input.domesticChoices) ? input.domesticChoices : ["DIRECT"],
    foreignChoices: Array.isArray(input.foreignChoices) ? input.foreignChoices : ["DIRECT"],
    processRules: Array.isArray(input.processRules) ? input.processRules : [],
    directIpRanges: Array.isArray(input.directIpRanges) ? input.directIpRanges : [],
    keepOriginalGroups: Array.isArray(input.keepOriginalGroups) ? input.keepOriginalGroups : [],
  };
}

function normalizeChains(chains) {
  return chains
    .map((chain) => {
      const hops = Array.isArray(chain.hops) ? chain.hops : [{ name: chain.name, proxy: chain.proxy }];
      const name = chain.name || chain.id;

      return {
        id: chain.id || name,
        name,
        chainName: chain.chainName || `${name}-Chain`,
        chainGroup: chain.chainGroup || `Chain-${name}`,
        hops: hops.filter((hop) => hop && hop.name && hop.proxy),
      };
    })
    .filter((chain) => chain.name && chain.hops.length > 0);
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
      directProxyMap.set(hop.name, { name: hop.name, ...hop.proxy });
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

function keepOnlyUsefulGroups(existingGroups, settings) {
  const groups = settings.groups;
  const keep = new Set([
    groups.originalSelect,
    groups.originalAuto,
    ...settings.keepOriginalGroups,
  ]);

  return (Array.isArray(existingGroups) ? existingGroups : []).filter((group) => {
    return group && group.name && keep.has(group.name);
  });
}

function addManagedGroups(config, chains, settings) {
  const groups = settings.groups;
  const existingGroupNames = new Set((config["proxy-groups"] || []).map((group) => group.name));
  const fallbackFrontChoices = [groups.originalSelect, groups.originalAuto, "DIRECT"].filter((name) => {
    return name === "DIRECT" || existingGroupNames.has(name);
  });

  upsertGroup(config, {
    name: groups.front,
    type: "select",
    proxies: fallbackFrontChoices.length > 0 ? fallbackFrontChoices : ["DIRECT"],
  });

  for (const chain of chains) {
    upsertGroup(config, {
      name: chain.chainGroup,
      type: "select",
      proxies: unique([chain.chainName, ...chain.hops.map((hop) => hop.name), "DIRECT"]),
    });
  }

  upsertGroup(config, {
    name: groups.domestic,
    type: "select",
    proxies: resolveChoiceList(settings.domesticChoices, settings, chains, ["DIRECT"]),
  });

  upsertGroup(config, {
    name: groups.foreign,
    type: "select",
    proxies: resolveChoiceList(settings.foreignChoices, settings, chains, ["DIRECT"]),
  });

  upsertGroup(config, {
    name: groups.default,
    type: "select",
    proxies: [groups.foreign, groups.domestic, "DIRECT"],
  });
}

function rebuildRules(config, settings, chains) {
  const groups = settings.groups;
  const processRules = buildProcessRules(settings.processRules, settings, chains);
  const directRules = buildDirectRules(config.rules, settings.directIpRanges);

  if (processRules.length > 0) {
    config["find-process-mode"] = "always";
  }

  if (settings.directIpRanges.length > 0) {
    config.tun = config.tun || {};
    const oldRanges = Array.isArray(config.tun["route-exclude-address"])
      ? config.tun["route-exclude-address"]
      : [];
    config.tun["route-exclude-address"] = unique([...oldRanges, ...settings.directIpRanges]);
  }

  config.rules = unique([
    ...processRules,
    ...directRules,
    `DOMAIN-SUFFIX,cn,${groups.domestic}`,
    `GEOIP,CN,${groups.domestic}`,
    `MATCH,${groups.foreign}`,
  ]);
}

function buildProcessRules(processRuleGroups, settings, chains) {
  return processRuleGroups.flatMap((item) => {
    const names = Array.isArray(item.names) ? item.names : [item.name || item.process].filter(Boolean);
    const policy = resolvePolicy(item.policy || "DIRECT", settings, chains);
    if (!policy) return [];
    return unique(names).map((name) => `PROCESS-NAME,${name},${policy}`);
  });
}

function buildDirectRules(existingRules, directIpRanges) {
  const kept = (Array.isArray(existingRules) ? existingRules : []).filter((rule) => {
    return typeof rule === "string" && shouldKeepDirectRule(rule);
  });

  return unique([
    ...kept,
    ...directIpRanges.map((range) => `IP-CIDR,${range},DIRECT,no-resolve`),
  ]);
}

function resolveChoiceList(tokens, settings, chains, fallback) {
  const resolved = unique(tokens.map((token) => resolvePolicy(token, settings, chains)).filter(Boolean));
  return resolved.length > 0 ? resolved : fallback;
}

function resolvePolicy(token, settings, chains) {
  const value = `${token || ""}`.trim();
  const upper = value.toUpperCase();

  if (!value) return null;
  if (upper === "DIRECT") return "DIRECT";
  if (upper === "DOMESTIC") return settings.groups.domestic;
  if (upper === "FOREIGN") return settings.groups.foreign;

  const chain = chains.find((item) => {
    return [item.id, item.name, item.chainGroup, item.chainName]
      .filter(Boolean)
      .some((name) => name.toUpperCase() === upper);
  });

  return chain ? chain.chainGroup : value;
}

function shouldKeepDirectRule(rule) {
  const parts = rule.split(",");
  const type = (parts[0] || "").trim().toUpperCase();
  const target = (parts[1] || "").trim().toLowerCase();
  const policy = (parts[2] || "").trim().toUpperCase();

  if (policy && policy !== "DIRECT") return false;

  if (type === "GEOIP" && target === "lan") return true;
  if (type === "IP-CIDR" || type === "IP-CIDR6") return isPrivateOrLocalCidr(target);
  if (type === "DOMAIN-SUFFIX" && target === "local") return true;
  if (type === "DOMAIN" && (target === "local.adguard.org" || target === "injections.adguard.org")) return true;

  // Keep subscription/provider website direct to avoid bootstrapping loops.
  if (target === "mojie.me" || target === "mojie.app") return true;

  return false;
}

function isPrivateOrLocalCidr(target) {
  return (
    target.startsWith("127.") ||
    target.startsWith("10.") ||
    target.startsWith("192.168.") ||
    target === "172.16.0.0/12" ||
    target === "100.64.0.0/10" ||
    target === "224.0.0.0/4" ||
    target === "fe80::/10" ||
    target === "::1/128" ||
    target === "fc00::/7"
  );
}

function upsertGroup(config, group) {
  config["proxy-groups"] = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];
  const groups = config["proxy-groups"];
  const index = groups.findIndex((item) => item.name === group.name);

  if (index >= 0) {
    groups[index] = { ...groups[index], ...group };
  } else {
    groups.unshift(group);
  }
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

if (typeof module !== "undefined") {
  module.exports = { main, USER_CONFIG };
}
