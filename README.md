# Wanderlog MCP

通过 Wanderlog 的只读分享链接，让支持 MCP 的 AI 助手读取和分析行程。每次调用都会重新获取分享页，从页面数据中读取行程分区和项目，不受页面虚拟列表的影响。

## 使用在线服务

在支持远程 MCP 的客户端中添加以下地址，认证方式选择**无认证**：

```text
https://mcp.738ngx.site/wanderlog/mcp
```

例如，在 ChatGPT 网页版的 Plugins 中添加自定义 MCP 服务器并安装，然后在对话中选择该插件：

> 使用 Wanderlog 工具读取这个分享链接，检查行程时间安排并给出建议：[分享链接]

行程修改后，要求助手重新读取即可。也可以在支持自定义 MCP 的其他客户端中使用该地址，具体接入方式取决于客户端。

在线服务无需认证，任何知道服务地址的人都可以调用；Cloudflare 到源站的连接使用 HTTP。

## 工具

`get_shared_itinerary` 支持以下参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `url` | string | 必填，Wanderlog `/view/.../shared` 或 `/plan/.../shared` 链接。 |
| `summaryOnly` | boolean | 只返回行程信息和分区目录。 |
| `date` | string | 只读取指定日期的分区，格式为 `YYYY-MM-DD`。 |
| `sectionIndex` | integer | 只读取目录中的指定分区，编号从 0 开始。 |

结果包含行程信息、分区和项目数量，以及选中分区的行程块。航班、住宿、地点和备注等以分享页返回的结构化数据呈现。长行程可以先读取目录，再按日期或分区查询。

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm ci
npm run start:http
```

MCP Streamable HTTP 地址为 `http://127.0.0.1:3000/mcp`，健康检查地址为 `http://127.0.0.1:3000/health`。可通过 `HOST` 和 `PORT` 环境变量调整监听地址和端口。

也可以使用 stdio 接入本地 MCP 客户端，将以下路径替换为实际项目路径：

```json
{
  "mcpServers": {
    "wanderlog": {
      "command": "node",
      "args": ["/absolute/path/to/Wanderlog-MCP/src/server.js"]
    }
  }
}
```

命令行读取：

```bash
node src/server.js 'https://wanderlog.com/view/SHARE_KEY/TRIP_NAME/shared' --summary
node src/server.js 'https://wanderlog.com/view/SHARE_KEY/TRIP_NAME/shared'
```

## Docker

```bash
docker build -t wanderlog-mcp .
docker run --rm -p 127.0.0.1:3000:3000 \
  -e HOST=0.0.0.0 \
  -e ALLOW_UNAUTHENTICATED_REMOTE=true \
  wanderlog-mcp
```

HTTP 服务默认监听本机。监听非本机地址且不启用认证时，需要显式设置 `ALLOW_UNAUTHENTICATED_REMOTE=true`。`deploy/` 包含 systemd 和 Nginx 配置示例。

## 数据范围

读取器返回分享页允许访问的行程分区和项目，不解析预算、日志或附件内容。它依赖 Wanderlog 页面中的数据结构，页面结构或分享权限变化时可能需要更新。

HTTP 服务每个进程最多允许每分钟 30 次行程读取、4 次并发读取。

## 测试

```bash
npm test
```

## 许可证

[MIT](LICENSE)
