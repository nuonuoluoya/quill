"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.message = exports.ApiError = exports.apiBase = exports.environment = exports.storage = void 0;
exports.uuid = uuid;
exports.navigate = navigate;
exports.toLibrary = toLibrary;
exports.back = back;
exports.confirm = confirm;
exports.request = request;
exports.storage = {
    get: (k) => wx.getStorageSync(k) || undefined,
    set: (k, v) => wx.setStorageSync(k, v),
    remove: (k) => wx.removeStorageSync(k),
    keys: () => wx.getStorageInfoSync().keys,
};
exports.environment = require('../config/config').environment;
exports.apiBase = require('../config/config').apiBaseUrl.replace(/\/$/, '');
function uuid() {
    const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function navigate(url) {
    wx.navigateTo({ url });
}
function toLibrary() {
    wx.reLaunch({ url: '/pages/library/library' });
}
function back(fallback = '/pages/library/library') {
    if (getCurrentPages().length > 1)
        wx.navigateBack();
    else
        wx.reLaunch({ url: fallback });
}
function confirm(title, content, confirmText) {
    return new Promise((resolve) => wx.showModal({
        title,
        content,
        confirmText,
        cancelText: '取消',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
    }));
}
function request(path, method, body, token) {
    return new Promise((resolve, reject) => {
        wx.request({
            url: exports.apiBase + path,
            method: method,
            data: body,
            timeout: 10000,
            header: {
                'Content-Type': 'application/json',
                'X-Quill-Capabilities': 'review-audio-v1',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            success: (r) => {
                var _a, _b, _c;
                const data = r.data;
                if (r.statusCode >= 200 && r.statusCode < 300 && data && 'data' in data)
                    resolve(data.data);
                else
                    reject(new ApiError(((_a = data === null || data === void 0 ? void 0 : data.error) === null || _a === void 0 ? void 0 : _a.code) || 'SERVICE_UNAVAILABLE', ((_b = data === null || data === void 0 ? void 0 : data.error) === null || _b === void 0 ? void 0 : _b.message) || '服务暂不可用', r.statusCode, ((_c = data === null || data === void 0 ? void 0 : data.error) === null || _c === void 0 ? void 0 : _c.details) || {}, data === null || data === void 0 ? void 0 : data.requestId));
            },
            fail: () => reject(new ApiError('NETWORK_ERROR', '网络连接失败，请检查网络', 0)),
        });
    });
}
class ApiError extends Error {
    constructor(code, message, status = 0, details = {}, requestId) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
        this.requestId = requestId;
    }
}
exports.ApiError = ApiError;
const message = (e) => (e instanceof Error ? e.message : '操作未完成，请重试');
exports.message = message;
