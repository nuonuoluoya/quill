const { createFavoritesPage } = require('./view');
const { favorites } = require('../../models/favorites');
Page(createFavoritesPage(favorites));
