/**
 * @fileoverview
 * 控制台端的指令系统，可以执行诸如登录，验证，重启插件的工作
 */

import verify from './verify'
import help from './help'
import reload from './reload'
import restart from './restart'
import stop from './stop'

export interface Command {
    description: string,
    usage: string,
    exec: (args: string[]) => void
}

export default {
    verify,
    help,
    reload,
    restart,
    stop
}
