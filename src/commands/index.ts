import verify from './verify'
import help from './help'

export interface Command {
    description: string,
    usage: string,
    exec: (args: string[]) => void
}

export default {
    verify,
    help
}
