"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.identity = exports.auth = void 0;
exports.onIdentityChange = onIdentityChange;
exports.login = login;
exports.api = api;
exports.logout = logout;
const events_1 = require("../utils/events");
const http_1 = require("../utils/http");
const { loginFailure } = require('../utils/login-error');
const key = `pidan:${http_1.environment}:session`;
let saved = null;
try {
    const v = http_1.storage.get(key);
    if (((_a = v === null || v === void 0 ? void 0 : v.user) === null || _a === void 0 ? void 0 : _a.id) && v.accessToken && v.expiresAt)
        saved = v;
}
catch { }
exports.auth = (0, events_1.observable)({ session: saved, epoch: 0, error: '', busy: false });
const listeners = new Set();
function onIdentityChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
const identity = () => { var _a; return ((_a = exports.auth.session) === null || _a === void 0 ? void 0 : _a.user.id) || 'guest'; };
exports.identity = identity;
function changed() {
    exports.auth.epoch++;
    for (const fn of listeners)
        fn();
}
let loginFlight = null;
async function login() {
    if (loginFlight)
        return loginFlight;
    const epoch = exports.auth.epoch;
    exports.auth.busy = true;
    exports.auth.error = '';
    loginFlight = (async () => {
        let code = '';
        // #ifdef MP-WEIXIN
        code = await new Promise((resolve, reject) => wx.login({
            timeout: 10000,
            success: (r) => resolve(r.code),
            fail: (error) => {
                const failure = loginFailure(error);
                console.warn('微信取码失败', failure.diagnostic);
                reject(new http_1.ApiError(failure.code, failure.message));
            },
        }));
        // #endif
        if (!code)
            throw new http_1.ApiError('WECHAT_REQUIRED', '请在微信小程序内登录后查看你的内容');
        const next = await (0, http_1.request)('/auth/wechat', 'POST', { code });
        if (epoch !== exports.auth.epoch)
            throw new http_1.ApiError('STALE_IDENTITY', '登录操作已取消');
        const old = (0, exports.identity)();
        exports.auth.session = next;
        if (old !== next.user.id)
            changed();
        try {
            http_1.storage.set(key, next);
        }
        catch {
            exports.auth.error = '登录仅保存在本次会话，重启后需重新登录';
        }
    })()
        .catch((e) => {
        if (epoch === exports.auth.epoch)
            exports.auth.error = e.message;
        throw e;
    })
        .finally(() => {
        exports.auth.busy = false;
        loginFlight = null;
    });
    return loginFlight;
}
async function api(path, method = 'GET', body, retryLogin = true) {
    var _a;
    const epoch = exports.auth.epoch, user = (0, exports.identity)();
    try {
        const result = await (0, http_1.request)(path, method, body, (_a = exports.auth.session) === null || _a === void 0 ? void 0 : _a.accessToken);
        if (epoch !== exports.auth.epoch)
            throw new http_1.ApiError('STALE_IDENTITY', '账号已切换');
        return result;
    }
    catch (e) {
        if (epoch !== exports.auth.epoch)
            throw new http_1.ApiError('STALE_IDENTITY', '账号已切换');
        if (e instanceof http_1.ApiError && e.status === 401 && exports.auth.session && retryLogin) {
            await login();
            if ((0, exports.identity)() !== user)
                throw new http_1.ApiError('STALE_IDENTITY', '账号已切换，原操作未重放');
            return api(path, method, body, false);
        }
        throw e;
    }
}
async function logout() {
    var _a;
    const token = (_a = exports.auth.session) === null || _a === void 0 ? void 0 : _a.accessToken, old = (0, exports.identity)();
    exports.auth.session = null;
    changed();
    exports.auth.error = '';
    try {
        http_1.storage.remove(key);
        for (const k of http_1.storage.keys())
            if (k.startsWith(`pidan:${http_1.environment}:${old}:`))
                http_1.storage.remove(k);
    }
    catch {
        exports.auth.error = '本机缓存清理失败，请在微信设置中清理小程序数据';
    }
    if (token)
        try {
            await (0, http_1.request)('/auth/session', 'DELETE', undefined, token);
        }
        catch {
            exports.auth.error = '已退出本机；远端会话将到期失效';
        }
}
