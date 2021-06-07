/**
 * @fileoverview
 * 该脚本用于生成 BotProxy 的接口函数
 * 还不能完全转换，所以需要后期调整
 */

const { readFileSync } = require('fs')
const { resolve } = require('path')
const ts = require('typescript')

const oicqPath = resolve(require.resolve('oicq'), '..')
const filename = resolve(oicqPath, require('oicq/package.json').types)

const source = ts.createSourceFile(filename, readFileSync(filename).toString(), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
/** @type {ts.ClassDeclaration[]} */
const classStatements = source.statements.filter(v => v.kind === ts.SyntaxKind.ClassDeclaration)
/** @type {ts.ClassDeclaration} */
const clientClass = classStatements.find(v => {
    return v.name && v.name.escapedText === 'Client'
})

/**
 * @param {ts.ParameterDeclaration} node
 */
function getOicqType (node) {
    if (node.type.kind === ts.SyntaxKind.StringKeyword) {
        return 'string'
    } else if (node.type.kind === ts.SyntaxKind.BooleanKeyword) {
        return 'boolean'
    } else if (node.type.kind === ts.SyntaxKind.NumberKeyword) {
        return 'number'
    }
    return 'Unknown'
}

for (const member of clientClass.members) {
    if (member.kind === ts.SyntaxKind.MethodDeclaration) {
        /** @type {ts.MethodDeclaration} */
        const method = member
        if (method.name && method.name.escapedText !== 'on') {
            const methodName = method.name.escapedText
            const args = method.parameters.map(v => {
                return v.name.escapedText.replace(/_([a-zA-Z])/g, (g) => g[1].toUpperCase())
            })
            const argDeclarations = method.parameters.map(v => {
                return v.name.escapedText.replace(/_([a-zA-Z])/g, (g) => g[1].toUpperCase()) + (v.questionToken ? '?' : '') + ': ' + (getOicqType(v))
            })
            if (method.jsDoc) {
                /** @type {ts.JSDoc[]} */
                const docs = method.jsDoc.map(v => v.comment).filter(v => !!v).join('\n').trim()
                if (docs.length) {
                    console.log('/**')
                    for (const doc of docs.split('\n')) {
                        console.log(' * ' + doc)
                    }
                    console.log(' */')
                }
            }
            console.log(methodName + ` (${argDeclarations.join(', ')}) {`)
            console.log('    return this.invoke(\'node-oicq-invoke\', {')
            console.log('        qqId: this.qqid,')
            console.log(`        methodName: '${methodName}',`)
            if (args.length) {
                console.log(`       arguments: [${args.join(', ')}],`)
            }
            console.log('    }) as Promise<Unknown>')
            console.log('}')
            console.log('')
        }
    }
}
