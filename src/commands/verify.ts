import { Command } from '.'
import { botWorkers, logger } from '..'
import { messages } from '../messages'

const verify: Command = {
    description: '验证滑块并登录指定账户',
    usage: 'verify (QQID) (TICKET)',
    exec (args) {
        if (args.length > 0) {
            switch (args[0]) {
            case 'verify':
            {
                if (args.length === 3) {
                    const qqid = parseInt(args[1])
                    const token = args[2]
                    const bot = botWorkers.get(qqid)
                    if (bot) {
                        bot.postMessage({
                            type: 'verify-message',
                            value: { token }
                        } as messages.VerifyMessage)
                    } else {
                        logger.error('指令错误：所指定的 QQID 的机器人线程不存在')
                    }
                } else {
                    logger.info('指令帮助：verify [qqid] [token]')
                }
                break
            }
            }
        }
    }
}

export default verify
