import { mountCollectionUI } from './ui/collections/pages';

mountCollectionUI(document, document.getElementById('folders') ? 'bookmarks' : 'history');
