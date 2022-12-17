import { Command } from '.'
import { botWorkers, logger } from '..'
import { messages } from '../messages'

const verify: Command = {
    description: '扫码后登录指定账户',
    usage: 'loginqrcode [qqid]',
    exec (args) {
        if (args.length > 0) {
            switch (args[0]) {
            case 'loginqrcode':
            {
                if (args.length === 2) {
                    const qqid = parseInt(args[1])
                    const bot = botWorkers.get(qqid)
                    if (bot) {
                        if (bot.hasOnline) {
                            bot.postMessage(messages.makeMessage('login-qrcode', {}))
                        } else {
                            logger.error('指令错误：所指定的 QQID 的机器人已经登录上线')
                        }
                    } else {
                        logger.error('指令错误：所指定的 QQID 的机器人线程不存在')
                    }
                } else if (args.length === 1) {
                    let invoked = false
                    for (const bot of botWorkers.values()) {
                        if (!bot.hasOnline) {
                            bot.postMessage(messages.makeMessage('login-qrcode', {}))
                            invoked = true
                            break
                        }
                    }
                    if (!invoked) {
                        logger.error('指令错误：当前没有未登录的用户')
                    }
                } else {
                    logger.info('指令帮助：loginqrcode [qqid]')
                }
                break
            }
            }
        }
    }
}

export default verify
