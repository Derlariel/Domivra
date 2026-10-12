import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/stores/auth'
import LoginPage from '@/pages/LoginPage.vue'
import PlatformPage from '@/pages/PlatformPage.vue'
import AdminPage from '@/pages/AdminPage.vue'
import ResidentPage from '@/pages/ResidentPage.vue'
import ResidentProfilePage from '@/pages/ResidentProfilePage.vue'

export const router = createRouter({ history:createWebHistory(), routes:[
  {path:'/',redirect:'/login'},
  {path:'/login',component:LoginPage},
  {path:'/platform',component:PlatformPage},
  {path:'/owner/:section?',component:AdminPage},
  {path:'/owner/residents/:id',component:ResidentProfilePage},
  {path:'/admin/:section?',redirect:to=>`/owner/${String(to.params.section||'overview')}`},
  {path:'/app/:section?',component:ResidentPage},
  {path:'/:pathMatch(.*)*',redirect:'/login'},
]})
router.beforeEach(async to=>{
  const auth=useAuth()
  if(!auth.ready)await auth.restore()
  const user=auth.user
  if(to.path==='/login')return user ? (user.role==='platform'?'/platform':user.role==='admin'?'/owner/overview':'/app/home') : true
  if(!user)return '/login'
  if(user.role==='platform'&&!to.path.startsWith('/platform'))return '/platform'
  if(user.role==='admin'&&!to.path.startsWith('/owner'))return '/owner/overview'
  if(user.role==='resident'&&!to.path.startsWith('/app'))return '/app/home'
  return true
})
