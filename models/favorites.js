const { Favorites } = require('../core/favorites');
const auth = require('./auth');
const { content } = require('./content');
const { storage, environment, uuid } = require('../utils/http');
const { emit } = require('../utils/events');
const favorites = new Favorites({ api:(...args)=>auth.api(...args),content,storage,uuid,now:()=>Date.now(),changed:emit,
  guestKey:`pidan:${environment}:guest:favorites`,scope:()=>({key:JSON.stringify([auth.identity(),auth.auth.epoch]),guest:!auth.auth.session}) });
auth.onIdentityChange(()=>{favorites.reset();emit();});
module.exports = { favorites };
