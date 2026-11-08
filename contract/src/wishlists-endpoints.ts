import type { Endpoint } from './endpoints.ts';

export const wishlistsEndpoints = {
  listWishlists: { method: 'GET', path: '/api/v1/wishlists', access: 'session' },
  addWishlistItem: { method: 'POST', path: '/api/v1/wishlist-items', access: 'session' },
  updateWishlistItem: { method: 'PATCH', path: '/api/v1/wishlist-items/{id}', access: 'creator' },
  removeWishlistItem: { method: 'DELETE', path: '/api/v1/wishlist-items/{id}', access: 'creator' },
  reorderWishlist: { method: 'PUT', path: '/api/v1/wishlist-items/order', access: 'session' },
  gotWishlistItem: { method: 'POST', path: '/api/v1/wishlist-items/{id}/got-it', access: 'creator' },
} as const satisfies Readonly<Record<string, Endpoint>>;
