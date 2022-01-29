/**
 * @fileoverview
 * 核心插件 - 唯一拥有调用诸如插件启用/禁用/重启、机器人关机重启等高级操作权限的插件
 */

import admin from './admin'
import onebot from './onebot'

export default [
    admin,
    onebot
]
