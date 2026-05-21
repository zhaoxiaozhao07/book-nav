# 书签助手 Chrome 扩展

`booknav-extension` 是 BookNav 的配套 Chrome / Chromium 扩展源码。它不会写入浏览器本地书签，而是通过用户在 BookNav 后台生成的 API Token，把当前页面保存到你的 BookNav 导航站。

## 功能

- 一键读取当前标签页 URL 和标题。
- 保存 URL、名称、描述、分类、公开/私有状态到 BookNav。
- 使用 OpenAI 兼容接口推荐分类，并生成链接描述。
- AI 只能推荐后台已有分类，不能新增分类。
- 右键菜单支持将当前页面带入添加弹窗。

## 安装

1. 打开 Chrome / Edge 的 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择仓库中的 `booknav-extension` 目录。

## 配对 BookNav

1. 登录 BookNav 后台。
2. 进入侧边栏“Chrome 插件”。
3. 点击“生成 Token”，复制仅显示一次的 API Token。
4. 打开扩展设置页。
5. 填写 BookNav 服务地址，例如 `https://nav.example.com`。
6. 粘贴 API Token，点击“保存并测试”。

## 配置 AI 分类

1. 在扩展设置页填写 AI 提供商名称、Base URL 和 API Key。
2. 点击“获取模型”，或手动输入模型名后点击“添加模型”。
3. 在弹窗中点击“AI 分类”，扩展会在已有分类中选择最匹配的一项，并自动填入链接描述。
4. 如果 AI 无法根据标题、URL 或已有描述判断有效信息，描述会被置为空。

> 新增分类必须在 BookNav 后台“分类管理”中手动创建。扩展和 AI 都不会创建新分类。

## 开发与打包

扩展是原生 Manifest V3 项目，无需构建即可加载。发布前可以直接压缩本目录内容：

```bash
cd booknav-extension
zip -r ../booknav-extension.zip .
```

不要提交 `.zip`、`.crx`、`.pem`、API Key 或本地环境文件。

## 安全说明

- API Token 和 AI API Key 保存在 Chrome 本地扩展存储中，请勿共享电脑或扩展目录。
- BookNav 后台只保存 Token 哈希，忘记 Token 时请吊销并重新生成。
- 生产环境建议使用 HTTPS，避免 Token 经明文 HTTP 传输。
