# Clash ProxyChain Script

这是给 Clash Verge Rev / Mihomo 用的全局脚本模板。目标不是维护一堆 App 分流，而是做一个普通人能理解的模型：

```text
进程例外优先 -> 本地/LAN直连 -> 国内IP走国内组 -> 其他全部走国外组
```

默认生成这些可选组：

| 组名 | 含义 | 默认可选 |
| --- | --- | --- |
| `Domestic-Sites` | 国内流量入口 | `DIRECT` / `Chain-US-Chicago` |
| `Foreign-Sites` | 国外流量入口 | `Chain-US-Chicago` / `DIRECT` |
| `Chain-US-Chicago` | 美国落地链路 | 链式 / 单独 SOCKS / `DIRECT` |
| `Chain-Front` | 链路前置节点 | 订阅的 `节点选择` / `自动选择` / `DIRECT` |
| `Default` | 兜底入口 | `Foreign-Sites` / `Domestic-Sites` / `DIRECT` |

## 最常见用法

只改 `Script.js` 顶部的 `USER_CONFIG`。

### 1. 填你的 SOCKS5 落地节点

```js
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
        },
      },
    ],
  },
],
```

如果 SOCKS5 不需要账号密码，删掉 `username` 和 `password`。

### 2. 国内流量怎么走

```js
domesticChoices: ["DIRECT", "US"],
```

意思是 Clash Verge 里 `Domestic-Sites` 这个组可以选：

- `DIRECT`：国内直连
- `US`：走 `id: "US"` 对应的链路，即 `Chain-US-Chicago`

你要国内默认走代理，就改成：

```js
domesticChoices: ["US", "DIRECT"],
```

### 3. 国外流量怎么走

```js
foreignChoices: ["US", "DIRECT"],
```

意思是国外默认走 US 链路。一般不用改。

### 4. 指定进程例外

微信/QQ/企业微信 这种有时候走 TUN/代理会很怪，所以默认保留进程直连：

```js
processRules: [
  {
    note: "WeChat / QQ / WeCom direct by default",
    policy: "DIRECT",
    names: ["wechat", "WeChat", "WeChat.exe", "qq", "QQ", "WXWork", "WXWork.exe", "WeCom", "WeMailNode.exe"],
  },
],
```

你想让某个进程强制走国外：

```js
{ note: "Telegram always foreign", policy: "FOREIGN", names: ["Telegram", "telegram-desktop"] },
```

你想让某个进程强制走国内组：

```js
{ note: "Chrome uses domestic bucket", policy: "DOMESTIC", names: ["chrome"] },
```

### 5. 指定域名直连

需要绕过所有代理策略，并让 Mihomo 用系统 DNS 解析时，可以配置：

```js
directDomains: [
  "git.datastory.com.cn",
],
```

脚本会生成 `DOMAIN,git.datastory.com.cn,DIRECT`，并给 `dns.nameserver-policy` 加上 `git.datastory.com.cn: system`。
这里填主机名即可，不要填 `https://`、路径或端口。

如果关 Clash/TUN 能访问，开 Clash/TUN 后同一域名直连超时，说明连接路径仍被 TUN 接管了。把解析出来的目标 IP 加到 `directIpRanges`，脚本会加入 `tun.route-exclude-address`：

```js
directIpRanges: [
  "28.0.0.6/32",
],
```

支持的 `policy`：

| policy | 含义 |
| --- | --- |
| `DIRECT` | 直连 |
| `DOMESTIC` | 走 `Domestic-Sites` |
| `FOREIGN` | 走 `Foreign-Sites` |
| `US` | 走 `id: "US"` 对应链路 |
| `Chain-US-Chicago` | 也可以直接写 Clash 里的组名 |

## 它到底怎么分流？

脚本会重建最终规则，避免订阅自带的“哔哩哔哩 / 抖音 / 某某服务”分组抢先命中。

最终核心规则类似：

```yaml
PROCESS-NAME,WeChat,DIRECT
DOMAIN-SUFFIX,local,DIRECT
GEOIP,LAN,DIRECT
DOMAIN-SUFFIX,cn,Domestic-Sites
GEOIP,CN,Domestic-Sites
MATCH,Foreign-Sites
```

也就是说：

- 国内不是按 App 名单分流；
- 国内主要按 `GEOIP,CN` 进入 `Domestic-Sites`；
- 国外全部进入 `Foreign-Sites`；
- B 站、抖音、知乎这类不会再因为订阅自带服务组被单独劫走。

## Clash Verge Rev 里怎么安装

### GUI 粘贴法

1. 打开 Clash Verge Rev。
2. 进入 `Profiles` / `配置`。
3. 找到全局增强项 `Script` / `Global Script` / `全局脚本`。
4. 编辑它，把本仓库 `Script.js` 全部复制进去。
5. 保存。
6. 刷新当前订阅或重启 Clash Verge Rev。

### 直接覆盖文件

Linux 常见路径：

```text
~/.local/share/io.github.clash-verge-rev.clash-verge-rev/profiles/Script.js
```

覆盖后刷新订阅即可。

## 多跳链路

多个 hop 按数组顺序写。最后一个 hop 是最终落地：

```js
{
  id: "US",
  name: "US-Chicago-via-NewYork",
  chainName: "US-Chicago-via-NewYork-Chain",
  chainGroup: "Chain-US-Chicago-via-NewYork",
  hops: [
    {
      name: "US-NewYork-Relay",
      proxy: { type: "socks5", server: "RELAY", port: 443, udp: true },
    },
    {
      name: "US-Chicago",
      proxy: { type: "socks5", server: "LANDING", port: 443, udp: true },
    },
  ],
}
```

链路方向：

```text
本机 -> Chain-Front -> US-NewYork-Relay -> US-Chicago -> 目标网站
```

## 注意

不要把带真实 `server`、`username`、`password` 的脚本公开发布。仓库模板里只应该放占位符。
