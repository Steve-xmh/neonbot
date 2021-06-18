type CQMessage = any

const cqRegExp = /^\[CQ:(?<type>\w+?)(?<params>(?:,(?:\w+?)=(?:[^[]\$,]+?))*)?\]$/

export function parseOne (cqcode: string): CQMessage {
    const matchResult = cqcode.match(cqRegExp)
    if (matchResult && matchResult.groups) {
        const data: { [_: string]: string } = {}
        if (typeof matchResult.groups.params === 'string') {
            const params = matchResult.groups.params.substring(1).split(',')
            for (const paramPair of params) {
                const equalPos = paramPair.indexOf('=')
                const key = paramPair.substring(0, equalPos)
                const value = paramPair.substring(equalPos + 1)
                data[key] = unescapeString(value)
            }
        }
        return {
            type: matchResult.groups.type as any,
            data
        }
    } else {
        throw new Error('Input isn\'t a single cqcode.')
    }
}

export function parse (cqcode: string): CQMessage[] {
    const result: CQMessage[] = []
    let str = cqcode
    while (str.length) {
        const nextLeft = str.search(/\[CQ:/)
        if (nextLeft === -1) { // No more cqcode, push them as text
            result.push({
                type: 'text',
                data: { text: unescapeString(str) }
            })
            str = ''
        } else {
            if (nextLeft > 0) {
                result.push({
                    type: 'text',
                    data: { text: unescapeString(str.substring(0, nextLeft)) }
                })
            }
            const nextRight = str.search(']')
            const cqcode = str.substring(nextLeft, nextRight + 1)
            result.push(parseOne(cqcode))
            str = str.substring(nextRight + 1)
        }
    }
    return result
}

export function tryParse (cqcode: string): CQMessage[] {
    try {
        return parse(cqcode)
    } catch {
        return []
    }
}

const cqEscapes: { [char: string]: string } = {
    '&': '&amp;',
    ',': '&#44',
    '[': '&#91;',
    ']': '&#93;'
}

export function escapeString (data: string) {
    let result = data
    for (const key in cqEscapes) {
        result = result.replaceAll(key, cqEscapes[key])
    }
    return result
}

export function unescapeString (data: string) {
    let result = data
    for (const key in cqEscapes) {
        result = result.replaceAll(cqEscapes[key], key)
    }
    return result
}

export function stringifyOne (cqcode: CQMessage) {
    return `[CQ:${cqcode.type}${cqcode.data
        ? `,${Object.entries(cqcode.data).map(v => {
            if (!['string', 'number'].includes(typeof v[1])) return ''
            const a = v[0] + '=' + escapeString(v[1] as string)
            return a
        }).join(',')
        }`
        : ''}]`
}

export function stringify (cqcodes: CQMessage[]) {
    const result = []
    for (const cqcode of cqcodes) {
        if (cqcode.type === 'text' && cqcode.data?.text) {
            result.push(cqcode.data.text)
        } else {
            result.push(stringifyOne(cqcode))
        }
    }
    return result.join('')
}
