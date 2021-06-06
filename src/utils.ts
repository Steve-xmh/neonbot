/**
 * @fileoverview
 * 常用的东西
 */

import { randomBytes } from 'crypto'

export const randonID = () => randomBytes(20).toString('base64')
