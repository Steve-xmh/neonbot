/**
 * @fileoverview
 * 插件的类型定义
 */

import { BotProxy } from './botproxy'
import { Logger } from 'log4js'

/**
 * 一个初始化时会被传递的配置对象
 */
export interface InitConfig {
    /** 配置文件中定义的管理员 QQID 列表 */
    admins: number[]
    /** 可以随意使用的 log4js.Logger 记录对象 */
    logger: Logger
}

/**
 * 一个插件对象，包含了与 NeonBot 交互的各个接口
 */
export default interface NeonPlugin {
    /**
     * 插件的名称
     */
    name?: string
    /**
     * 插件的 ID，推荐以 Java 包名的方式命名（net.bob.plugin）
     */
    id: string
    /**
     * 插件的短名，用于记录器（logger）的类型标识
     */
    shortName: string
    /**
     * 插件初始化函数，这将在启动 NeonBot 创建插件线程时第一个被调用
     */
    init?: (config: InitConfig) => Promise<void>
    /**
     * 插件在一个机器人上被启用时调用，此时可以处理相关的机器人操作
     */
    enable?: (bot: BotProxy) => Promise<void>
    /**
     * 插件在一个机器人上被禁用时调用，此时可以处理相关的机器人操作
     *
     * 为了良好的代码习惯，请在此解除挂载一系列先前挂载的事件
     */
    disable?: (bot: BotProxy) => Promise<void>
    /**
     * 插件卸载函数，将在 NeonBot 被关闭前调用，请在此处立即处理需要关闭的东西
     */
    uninit?: () => Promise<void>
}
