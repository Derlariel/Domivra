<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Building2, LogOut, Plus } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import FormDialog, { type Field } from '@/components/FormDialog.vue'
import { get, post, patch, message, statusName, type Row } from '@/lib/api'
import { useAuth } from '@/stores/auth'
const auth=useAuth(),router=useRouter(),client=useQueryClient(),open=ref(false),error=ref(''),credentials=ref('')
const {data:organizations}=useQuery({queryKey:['organizations'],queryFn:()=>get<Row[]>('/organizations')})
const fields:Field[]=[{name:'name',label:'ชื่อองค์กร'},{name:'slug',label:'รหัสองค์กรภาษาอังกฤษ'},{name:'admin_name',label:'ชื่อผู้ดูแล'},{name:'username',label:'ชื่อผู้ใช้ของผู้ดูแล'}]
async function create(values:Record<string,unknown>){const result=await post<{slug:string;username:string;password:string}>('/organizations',values);credentials.value=`รหัสองค์กร: ${result.slug}\nชื่อผู้ใช้: ${result.username}\nรหัสผ่านครั้งแรก: ${result.password}`;await client.invalidateQueries({queryKey:['organizations']})}
async function toggle(row:Row){try{error.value='';await patch(`/organizations/${row.id}`,{status:row.status==='active'?'suspended':'active'});await client.invalidateQueries({queryKey:['organizations']})}catch(e){error.value=message(e)}}
async function logout(){await auth.logout();await router.replace('/login')}
</script>
<template><div class="app-shell flex"><aside class="sidebar p-6"><div class="font-bold text-xl mb-2 flex gap-2 items-center"><Building2 class="brand" /> domivra</div><p class="text-xs tracking-widest text-slate-400 mb-8">PLATFORM BACK OFFICE</p><div class="nav-item active"><Building2 :size="18" /> องค์กรลูกค้า</div><p class="text-sm text-slate-500 mt-10">{{ auth.user?.name }}</p></aside><div class="flex-1 min-w-0"><header class="bg-white border-b px-7 py-4 flex justify-between"><strong>จัดการลูกค้า Domivra</strong><Button variant="outline" @click="logout"><LogOut :size="16" /> ออกจากระบบ</Button></header><main class="p-6 md:p-10 max-w-6xl mx-auto"><div class="flex justify-between items-start mb-6"><div><h1 class="text-3xl font-bold">องค์กรลูกค้า</h1><p class="text-slate-500">สร้างบัญชีและกำหนดสถานะการใช้งาน</p></div><Button class="brand-bg text-white" @click="open=true"><Plus :size="16" /> เพิ่มองค์กร</Button></div>
<Card v-if="credentials" class="mb-5 border-emerald-300"><CardHeader><CardTitle>ข้อมูลเข้าระบบครั้งแรก</CardTitle></CardHeader><CardContent><pre class="whitespace-pre-wrap">{{ credentials }}</pre><p class="text-sm text-slate-500 mt-2">บันทึกและส่งให้ผู้ดูแลผ่านช่องทางที่ปลอดภัย ข้อมูลนี้จะไม่แสดงซ้ำ</p><Button variant="outline" class="mt-2" @click="credentials=''">ปิด</Button></CardContent></Card>
<p v-if="error" class="error-text mb-3">{{ error }}</p><Card><CardContent class="pt-5 table-wrap"><Table><TableHeader><TableRow><TableHead>รหัสองค์กร</TableHead><TableHead>ชื่อองค์กร</TableHead><TableHead>สถานะ</TableHead><TableHead /></TableRow></TableHeader><TableBody><TableRow v-for="row in organizations" :key="row.id"><TableCell>{{ row.slug }}</TableCell><TableCell>{{ row.name }}</TableCell><TableCell><span class="pill">{{ statusName(row.status) }}</span></TableCell><TableCell><Button variant="outline" size="sm" @click="toggle(row)">{{ row.status==='active'?'พักการใช้งาน':'เปิดใช้งาน' }}</Button></TableCell></TableRow></TableBody></Table></CardContent></Card></main></div><FormDialog v-if="open" title="เพิ่มองค์กรลูกค้า" :fields="fields" :save="create" @close="open=false" /></div></template>
