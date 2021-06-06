import commands, { Command } from '.'
import { logger } from '..'

const help: Command = {
    description: '显示本帮助',
    usage: 'help [COMMAND]',
    exec (args) {
        if (args.length === 2) {
            const cmd = args[1]
            if (cmd in commands) {
                const command = (commands as any)[cmd] as Command
                logger.info(`--- ${cmd} 指令帮助 ---`)
                logger.info(command.description)
                logger.info(`用法：${command.usage}`)
            } else {
                logger.info('找不到该指令，输入 help 查看所有可用指令')
            }
        } else {
            let longestCommand = 0
            Object.keys(commands).forEach(v => {
                longestCommand = v.length > longestCommand ? v.length : longestCommand
            })
            const sortedCommands = [...Object.keys(commands)].sort()
            logger.info('--- 帮助 ---')
            for (const cmdName in sortedCommands) {
                const command = (sortedCommands as any)[cmdName] as Command
                logger.info(`${' '.repeat(longestCommand - cmdName.length)}${cmdName} - ${command.description}`)
            }
        }
    }
}

export default help
