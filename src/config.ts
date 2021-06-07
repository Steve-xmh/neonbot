/**
 * @fileoverview
 * 用于读写插件配置文件的东西
 */

import { constants } from 'fs'
import { access, readFile, writeFile } from 'fs/promises'
import { lock, unlock } from 'lockfile'
import { config as neonbotConfig } from '.'

export interface PluginConfig {
    [pluginId: string]: {
        /** 插件已向哪些 QQ 机器人账户启用 */
        enabledQQIds: number[]
        /** 插件的全局共享数据，所有机器人账户均通用，可以自由设置 */
        savedData: any
        /** 插件的局部共享数据，以每个机器人账户独立，可以自由设置 */
        localSavedData: {
            [qqId: number]: any
        }
    }
}

let config: PluginConfig = {}

export function saveConfig () {
    return new Promise<void>((resolve, reject) => {
        const lockFile = neonbotConfig.pluginSearchPath + '.lock'
        lock(lockFile, async (err) => {
            if (err) {
                reject(err)
            } else {
                writeFile(neonbotConfig.pluginDataFile!!, JSON.stringify(config, null, 4))
                    .then(() => {
                        unlock(lockFile, (err) => {
                            if (err) {
                                reject(err)
                            } else {
                                resolve()
                            }
                        })
                    })
                    .catch((err) => {
                        unlock(lockFile, (lockErr) => {
                            if (lockErr) {
                                reject(lockErr)
                            } else {
                                reject(err)
                            }
                        })
                    })
            }
        })
    })
}

export function loadConfig () {
    return new Promise<PluginConfig>((resolve, reject) => {
        const lockFile = neonbotConfig.pluginSearchPath + '.lock'
        lock(lockFile, async (err) => {
            if (err) {
                reject(err)
            } else {
                access(neonbotConfig.pluginDataFile!!, constants.F_OK | constants.R_OK)
                    .catch(() => {
                        unlock(lockFile, (err) => {
                            if (err) {
                                reject(err)
                            } else {
                                try {
                                    resolve({})
                                } catch (err) {
                                    reject(err)
                                }
                            }
                        })
                    })
                    .then(() => {
                        return readFile(neonbotConfig.pluginDataFile!!, {
                            encoding: 'utf8'
                        })
                    })
                    .then((data) => {
                        unlock(lockFile, (err) => {
                            if (err) {
                                reject(err)
                            } else {
                                try {
                                    config = JSON.parse(data || '{}')
                                    resolve(config)
                                } catch (err) {
                                    reject(err)
                                }
                            }
                        })
                    })
                    .catch((err) => {
                        unlock(lockFile, (lockErr) => {
                            if (lockErr) {
                                reject(lockErr)
                            } else {
                                reject(err)
                            }
                        })
                    })
            }
        })
    })
}
