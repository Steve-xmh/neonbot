# NeonBot
一个基于 abot 概念，使用 Worker Thread 分离机器人和插件运行环境的机器人运行框架！

## 理念
本框架参考了 [takayama-lily/abot](https://github.com/takayama-lily/abot) 框架，并借此增强了以下功能：

- 所有的插件，机器人均有自己的单独线程运行，互不干扰，重启方便，避免了一些使用了诸如 `http` 库的插件出错导致整个框架崩溃的问题
- 以不污染库本身为前提，提供更将灵活的配置方式和插件配置方式
- 速度不慢，内存也很友好，后面也会通过其他方式提高插件与机器人的交互性能
- 插件/配置/数据独立化，不会干扰或污染 NeonBot 本身，方便部分喜欢一直跟进更新的用户使用 `git pull` 直接更新版本

## 安装
作者开发时使用的软件包管理器是 `yarn`，当然你也可以使用 `npm`。

克隆本仓库，切换至 `dev` 分支（如果你想体验最新开发版本的话），然后使用以下指令构建源代码并开始运行：

```shell
yarn
yarn dist
yarn start [配置文件路径]
```

而后需要更新则只需要：
```shell
yarn up # 使用 git pull 拉取仓库新源代码，然后构建
```

## 配置文件
配置文件可以参考 `src/index.ts` 中对配置文件的类型定义进行设置，将会使用 `require` 函数来加载配置文件，故可以为 `json` 文件或 `js` 脚本  
作者个人喜好用 `neonbot.config.js` 或 `neonbot.config.json` 作为配置文件的名称。

## 从 abot 迁移
迁移插件其实非常简单，目前只需要：

- 在导出中加个 `id` 和 `shortName` 字段用于记录输出/插件标识
- **去掉你的所有同步访问 `Bot` 字段和函数，全部改用异步调用（非常重要，因为多线程操作是注定异步的），详情可以查阅 `src/botproxy.ts` 中的 `BotProxy` 类**
- 将导出中的 `activate` 改名为 `enable`
- 将导出中的 `deactivate` 改名为 `disable`

更多可选导出请参考 `src/plugin.ts` 中的 `NeonPlugin` 接口

## 路线图
当前代码开发仍然以自用需求为先，会先完成自己需要的功能，然后逐步给大家完善其他功能。
