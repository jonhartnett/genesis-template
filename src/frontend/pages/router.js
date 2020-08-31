import VueRouter from 'vue-router';
import MainPage from './main-page';

export const router = new VueRouter({
    routes: [
        {
            path: '/',
            component: MainPage
        }
    ]
});