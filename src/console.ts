/**
 * @fileoverview
 * 处理从终端输入的各种指令
 */

import { createInterface } from 'readline'
import { logger } from '.'
import commands, { Command } from './commands'

export function setupConsole () {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    })
    rl.on('line', (line) => {
        if (line && line.trim().length > 0) {
            const args = line.match(/"[^"]*"|[^\s"]+/g)!!.map(v => {
                if (v.startsWith('"') && v.endsWith('"')) {
                    return v.substring(1, v.length - 1)
                } else {
                    return v
                }
            })
            if (args.length > 0) {
                const cmd = args[0]
                if (cmd in commands) {
                    ((commands as any)[cmd] as Command).exec(args)
                } else {
                    logger.warn('未知指令，输入 help 以查看帮助')
                }
            }
        }
    })
}
