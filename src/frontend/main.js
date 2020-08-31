import Vue from 'vue';
import VueRouter from 'vue-router';
import { router } from './pages/router';
import {getName} from '@/backend/api/user.api';

Vue.config.productionTip = false;

Vue.use(VueRouter);

new Vue({
    router,
    render: h => h('router-view')
}).$mount('#app');

getName('arg1', 'arg2', 3)
    .then(console.log, console.error);
