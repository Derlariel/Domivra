<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Building2, KeyRound, LogOut, Plus } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import FormDialog, { type Field } from '@/components/FormDialog.vue'
import { get, post, patch, message, statusName, type Row } from '@/lib/api'
import { useAuth } from '@/stores/auth'

type Owner = { id: string; name: string; username: string }
type Organization = Row & { slug: string; name: string; status: string; owners: Owner[] }
const auth=useAuth(),router=useRouter(),client=useQueryClient()
const createOpen=ref(false),ownerOrg=ref<Organization|null>(null),passwordOpen=ref(false)
const error=ref(''),notice=ref(''),credentials=ref(''),busyOwner=ref('')
const {data:organizations}=useQuery({queryKey:['organizations'],queryFn:()=>get<Organization[]>('/organizations')})
const organizationFields:Field[]=[{name:'name',label:'ชื่อหอพักหรือบริษัท'},{name:'slug',label:'รหัสองค์กรภาษาอังกฤษ'},{name:'admin_name',label:'ชื่อเจ้าของหรือผู้จัดการ'},{name:'username',label:'ชื่อผู้ใช้ของเจ้าของ'}]
const ownerFields:Field[]=[{name:'name',label:'ชื่อเจ้าของหรือผู้จัดการ'},{name:'username',label:'ชื่อผู้ใช้'}]
const passwordFields:Field[]=[{name:'current',label:'รหัสผ่านปัจจุบัน',type:'password'},{name:'next',label:'รหัสผ่านใหม่อย่างน้อย 12 ตัวอักษร',type:'password'}]
function showCredentials(organization:string,username:string,password:string){credentials.value=`รหัสองค์กร: ${organization}\nชื่อผู้ใช้: ${username}\nรหัสผ่าน: ${password}`}
async function refresh(){await client.invalidateQueries({queryKey:['organizations']})}
async function create(values:Record<string,unknown>){const result=await post<{slug:string;username:string;password:string}>('/organizations',values);showCredentials(result.slug,result.username,result.password);await refresh()}
async function addOwner(values:Record<string,unknown>){if(!ownerOrg.value)return;const result=await post<{username:string;password:string}>(`/organizations/${ownerOrg.value.id}/owners`,values);showCredentials(ownerOrg.value.slug,result.username,result.password);await refresh()}
async function resetOwner(owner:Owner){try{error.value='';busyOwner.value=owner.id;const result=await post<{organization:string;username:string;password:string}>(`/owners/${owner.id}/reset-password`,{});showCredentials(result.organization,result.username,result.password)}catch(e){error.value=message(e)}finally{busyOwner.value=''}}
async function toggle(row:Organization){try{error.value='';await patch(`/organizations/${row.id}`,{status:row.status==='active'?'suspended':'active'});await refresh()}catch(e){error.value=message(e)}}
async function changePassword(values:Record<string,unknown>){await post('/password',values);error.value='';notice.value='เปลี่ยนรหัสผ่านแอดมิน Domivra แล้ว'}
async function logout(){await auth.logout();await router.replace('/login')}
</script>
<template><div class="app-shell flex"><aside class="sidebar p-6"><div class="font-bold text-xl mb-2 flex gap-2 items-center"><Building2 class="brand" /> Domivra</div><p class="text-xs tracking-widest text-slate-400 mb-8">PLATFORM BACK OFFICE</p><div class="nav-item active"><Building2 :size="18" /> ลูกค้าและบัญชีเจ้าของ</div><p class="text-sm text-slate-500 mt-10">{{ auth.user?.name }}</p></aside><div class="flex-1 min-w-0"><header class="bg-white border-b px-7 py-4 flex justify-between gap-3"><strong>หลังบ้าน Domivra</strong><div class="flex gap-2"><Button variant="outline" @click="passwordOpen=true"><KeyRound :size="16" /> เปลี่ยนรหัสผ่าน</Button><Button variant="outline" @click="logout"><LogOut :size="16" /> ออกจากระบบ</Button></div></header><main class="p-6 md:p-10 max-w-6xl mx-auto"><div class="flex flex-wrap justify-between items-start gap-4 mb-6"><div><h1 class="text-3xl font-bold">ลูกค้าของ Domivra</h1><p class="text-slate-500">จัดการบัญชีเจ้าของหอพักและสิทธิ์ใช้งานองค์กร ลูกบ้านอยู่ภายใต้การดูแลของเจ้าของแต่ละราย</p></div><Button class="brand-bg text-white" @click="createOpen=true"><Plus :size="16" /> เพิ่มลูกค้า</Button></div>
<Card v-if="credentials" class="mb-5 border-emerald-300"><CardHeader><CardTitle>ข้อมูลเข้าระบบสำหรับเจ้าของหอพัก</CardTitle></CardHeader><CardContent><pre class="whitespace-pre-wrap">{{ credentials }}</pre><p class="text-sm text-slate-500 mt-2">บันทึกและส่งให้เจ้าของผ่านช่องทางที่ปลอดภัย รหัสผ่านนี้จะไม่แสดงซ้ำ</p><Button variant="outline" class="mt-2" @click="credentials=''">ปิด</Button></CardContent></Card>
<p v-if="error" class="error-text mb-3" role="alert">{{ error }}</p><p v-if="notice" class="p-3 rounded-lg bg-emerald-50 text-emerald-800 mb-4" role="status">{{ notice }}</p><Card><CardContent class="pt-5 table-wrap"><Table><TableHeader><TableRow><TableHead>รหัสองค์กร</TableHead><TableHead>ลูกค้า</TableHead><TableHead>บัญชีเจ้าของ/ผู้จัดการ</TableHead><TableHead>สถานะ</TableHead><TableHead>จัดการ</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="row in organizations" :key="row.id"><TableCell>{{ row.slug }}</TableCell><TableCell>{{ row.name }}</TableCell><TableCell><div v-for="owner in row.owners" :key="owner.id" class="flex items-center gap-2 py-1"><span>{{ owner.name }} ({{ owner.username }})</span><Button variant="outline" size="sm" :disabled="busyOwner===owner.id" @click="resetOwner(owner)">ออกรหัสใหม่</Button></div><span v-if="!row.owners.length" class="text-slate-500">ยังไม่มีบัญชี</span></TableCell><TableCell><span class="pill">{{ statusName(row.status) }}</span></TableCell><TableCell><div class="flex flex-wrap gap-2"><Button variant="outline" size="sm" @click="ownerOrg=row">เพิ่มบัญชีเจ้าของ</Button><Button variant="outline" size="sm" @click="toggle(row)">{{ row.status==='active'?'พักการใช้งาน':'เปิดใช้งาน' }}</Button></div></TableCell></TableRow></TableBody></Table><p v-if="!organizations?.length" class="text-center text-slate-500 py-8">ยังไม่มีลูกค้า</p></CardContent></Card></main></div>
<FormDialog v-if="createOpen" title="เพิ่มลูกค้า Domivra" :fields="organizationFields" :save="create" @close="createOpen=false" />
<FormDialog v-if="ownerOrg" :title="`เพิ่มบัญชีเจ้าของ: ${ownerOrg.name}`" :fields="ownerFields" :save="addOwner" @close="ownerOrg=null" />
<FormDialog v-if="passwordOpen" title="เปลี่ยนรหัสผ่านแอดมิน Domivra" :fields="passwordFields" :save="changePassword" @close="passwordOpen=false" />
</div></template>
