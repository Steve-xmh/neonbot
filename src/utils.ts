/**
 * @fileoverview
 * 常用的东西
 */

import { X509Certificate } from 'crypto'
import { nanoid } from 'nanoid'
import { TransferListItem, MessagePort } from 'worker_threads'

export const randonID = nanoid

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

/** 将所给数据进行复原，主要是将 ArrayBuffer 转换成原有形式 */
export function restoreObject<T = any> (data: T): T {
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data) as any
    }
    switch (typeof data) {
    case 'object':
    {
        for (const key in data) {
            if (data[key] instanceof ArrayBuffer) {
                data[key] = Buffer.from(data[key] as any) as any
            } else if (typeof data[key] === 'object') {
                data[key] = restoreObject(data[key])
            }
        }
        break
    }
    default:
    }
    return data
}

export function purifyObject (data: any) {
    const transferList: TransferListItem[] = []
    switch (typeof data) {
    case 'object': {
        for (const key in data) {
            if (data[key] instanceof Buffer ||
                        data[key] instanceof ArrayBuffer ||
                        data[key] instanceof Uint8Array ||
                        data[key] instanceof Uint16Array ||
                        data[key] instanceof Uint32Array ||
                        data[key] instanceof Int8Array ||
                        data[key] instanceof Int16Array ||
                        data[key] instanceof Int32Array ||
                        data[key] instanceof MessagePort ||
                        data[key] instanceof X509Certificate) {
                if (
                    data[key] instanceof Uint8Array ||
                    data[key] instanceof Uint16Array ||
                    data[key] instanceof Uint32Array ||
                    data[key] instanceof Int8Array ||
                    data[key] instanceof Int16Array ||
                    data[key] instanceof Int32Array
                ) { // 将参数中的 Uint8Array 转换成 Buffer
                    data[key] = data[key].buffer
                }
                continue
            }
            switch (typeof data[key]) {
            case 'function':
                delete data[key]
                break
            case 'object': transferList.push(...purifyObject(data[key]).transferList)
                break
            default:
            }
        }
        break
    } case 'function': {
        return {
            data: undefined,
            transferList
        }
    }
    default:
    {
        if (data instanceof Buffer ||
                    data instanceof ArrayBuffer ||
                    data instanceof Uint8Array ||
                    data instanceof Uint16Array ||
                    data instanceof Uint32Array ||
                    data instanceof Int8Array ||
                    data instanceof Int16Array ||
                    data instanceof Int32Array ||
                    data instanceof MessagePort ||
                    data instanceof X509Certificate) {
            if (
                data instanceof Uint8Array ||
                data instanceof Uint16Array ||
                data instanceof Uint32Array ||
                data instanceof Int8Array ||
                data instanceof Int16Array ||
                data instanceof Int32Array
            ) { // 将参数中的 Uint8Array 转换成 ArrayBuffer
                data = data.buffer
            }
            return { data, transferList: [data] }
        }
    }
    }
    return { data, transferList }
}
