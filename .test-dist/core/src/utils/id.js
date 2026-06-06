"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uid = void 0;
const uid = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
exports.uid = uid;
