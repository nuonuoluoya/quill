// Keep SDK diagnostics useful without exposing raw errors or login credentials.
function loginFailure(error = {}) {
  error = error || {};
  const text = typeof error.errMsg === 'string' ? error.errMsg : '';
  let code = 'WX_LOGIN_FAILED', message = '微信登录暂时失败，请退出小程序后重新进入再试';
  if (/Anonymous QA does not log in|QA.*login.*disabled/i.test(text)) {
    code = 'WX_LOGIN_TEST_PACKAGE'; message = '当前为测试版本，无法登录，请使用正式版本';
  } else if (/timeout|timed out|超时/i.test(text)) {
    code = 'WX_LOGIN_TIMEOUT'; message = '微信登录超时，请检查网络后重试';
  } else if (/network|offline|connect|网络/i.test(text)) {
    code = 'WX_LOGIN_NETWORK'; message = '微信登录网络异常，请切换网络后重试';
  }
  const rawCode = error.errCode ?? error.errno;
  const sdkCode = /^-?\d{1,8}$/.test(String(rawCode)) ? Number(rawCode) : null;
  return { code, message: message + '（' + code + (sdkCode === null ? '' : ' / ' + sdkCode) + '）',
    diagnostic: { stage: 'wx.login', code, sdkCode } };
}
module.exports = { loginFailure };
