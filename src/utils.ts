/**
 * @fileoverview
 * 常用的东西
 */

import { randomBytes } from 'crypto'

export const randonID = () => randomBytes(20).toString('base64')

export function formatBinarySize (v: number) {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']
    for (let i = 0; i < units.length; i++) {
        if (v < 1024) {
            return v.toFixed(2) + ' ' + units[i]
        }
        v /= 1024
    }
    return (v * 1024).toFixed(2) + ' ' + units[units.length - 1]
}

export const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function getDuration (t: Date) {
    let d = Math.floor((new Date().getTime() - t.getTime()) / 1000)
    if (d <= 0) {
        return '刚刚'
    }
    let result = d % 60 + ' 秒前'
    d = Math.floor(d / 60)
    if (d % 60) {
        result = d % 60 + ' 分 ' + result
        d = Math.floor(d / 60)
        if (d % 24) {
            result = d % 24 + ' 时 ' + result
            d = Math.floor(d / 24)
            if (d > 0) {
                result = d + ' 天 ' + result
            }
        }
    }
    return result
}
