import verify from './verify'
import help from './help'
import reload from './reload'
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
    stop
}
