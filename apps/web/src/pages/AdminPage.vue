<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { LayoutDashboard, Building2, KeyRound, Users, FileText, Receipt, Wallet, LogOut, Wrench, Megaphone, Shield, ChartNoAxesCombined, Sparkles, Settings, AlertTriangle, Upload, Plus, Database } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import FormDialog, { type Field } from '@/components/FormDialog.vue'
import { get, post, patch, message, currency, date, statusName, fileData, type Row } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import DatasetManager from './DatasetManager.vue'
const route=useRoute(),router=useRouter(),auth=useAuth(),client=useQueryClient()
const section=computed(()=>String(route.params.section||'overview'))
const nav=[
  {id:'overview',label:'ภาพรวม',icon:LayoutDashboard},{id:'properties',label:'อาคารและส่วนกลาง',icon:Building2},{id:'units',label:'ห้องพัก',icon:KeyRound},{id:'residents',label:'ผู้พัก',icon:Users},
  {id:'contracts',label:'สัญญาเช่า',icon:FileText},{id:'billing',label:'บิลและมิเตอร์',icon:Receipt},{id:'payments',label:'ตรวจรับชำระ',icon:Wallet},{id:'moveouts',label:'คำขอย้ายออก',icon:LogOut},
  {id:'maintenance',label:'แจ้งซ่อมห้อง',icon:Wrench},{id:'incidents',label:'ปัญหาส่วนกลาง',icon:AlertTriangle},{id:'announcements',label:'ประกาศ',icon:Megaphone},{id:'rules',label:'กฎระเบียบ',icon:Shield},
  {id:'reports',label:'รายงาน',icon:ChartNoAxesCombined},{id:'insights',label:'วิเคราะห์ข้อมูล',icon:Sparkles},{id:'datasets',label:'ข้อมูลของหอพัก',icon:Database},{id:'import',label:'นำเข้าห้อง',icon:Upload},{id:'audit',label:'ประวัติการใช้งาน',icon:Shield},{id:'settings',label:'ตั้งค่า',icon:Settings},
]
const title=computed(()=>nav.find(x=>x.id===section.value)?.label||'ข้อมูล')
const endpoint=computed(()=>({billing:'invoices',import:'imports',reports:'overview'} as Record<string,string>)[section.value]||section.value)
const {data,isPending,error:loadError}=useQuery<unknown>({queryKey:computed(()=>['admin',section.value]),queryFn:()=>get<unknown>(`/${endpoint.value}`),enabled:computed(()=>section.value!=='datasets'),retry:1})
const list=computed<Row[]>(()=>Array.isArray(data.value)?data.value as Row[]:[])
const overview=computed(()=>!Array.isArray(data.value)&&data.value&&typeof data.value==='object'?data.value as Record<string,unknown>:{})
const columns:Record<string,{key:string;label:string}[]>={
  properties:[{key:'name',label:'ชื่อโครงการ'},{key:'address',label:'ที่อยู่'}],
  units:[{key:'number',label:'ห้อง'},{key:'building',label:'อาคาร'},{key:'floor',label:'ชั้น'},{key:'resident',label:'ผู้พัก'},{key:'rent',label:'ค่าเช่า'},{key:'status',label:'สถานะ'}],
  residents:[{key:'name',label:'ชื่อ'},{key:'username',label:'ชื่อผู้ใช้'},{key:'number',label:'ห้อง'}],
  contracts:[{key:'number',label:'ห้อง'},{key:'name',label:'ผู้ถือสัญญา'},{key:'start_date',label:'เริ่ม'},{key:'end_date',label:'สิ้นสุด'},{key:'rent',label:'ค่าเช่า'},{key:'sign_mode',label:'รูปแบบ'},{key:'sign_status',label:'ลงนาม'}],
  billing:[{key:'number',label:'ห้อง'},{key:'period',label:'งวด'},{key:'amount',label:'ยอดบิล'},{key:'due',label:'ครบกำหนด'},{key:'status',label:'สถานะ'}],
  payments:[{key:'number',label:'ห้อง'},{key:'name',label:'ผู้ชำระ'},{key:'amount',label:'ยอด'},{key:'created_at',label:'ส่งเมื่อ'},{key:'status',label:'สถานะ'}],
  moveouts:[{key:'number',label:'ห้อง'},{key:'name',label:'ผู้พัก'},{key:'move_date',label:'วันย้าย'},{key:'status',label:'สถานะ'}],
  maintenance:[{key:'number',label:'ห้อง'},{key:'name',label:'ผู้แจ้ง'},{key:'subject',label:'หัวข้อ'},{key:'detail',label:'รายละเอียด'},{key:'status',label:'สถานะ'}],
  incidents:[{key:'property',label:'โครงการ'},{key:'area',label:'จุดที่พบ'},{key:'reporter',label:'ผู้แจ้ง'},{key:'detail',label:'รายละเอียด'},{key:'status',label:'สถานะ'}],
  announcements:[{key:'title',label:'หัวข้อ'},{key:'category',label:'หมวด'},{key:'building',label:'อาคาร'},{key:'read_count',label:'อ่านแล้ว'},{key:'status',label:'สถานะ'}],
  rules:[{key:'title',label:'หัวข้อ'},{key:'body',label:'รายละเอียด'},{key:'read_count',label:'รับทราบแล้ว'}],
  import:[{key:'filename',label:'ไฟล์'},{key:'imported',label:'เพิ่มใหม่'},{key:'skipped',label:'ข้าม'},{key:'created_at',label:'วันที่'}],
  audit:[{key:'created_at',label:'เวลา'},{key:'actor_name',label:'ผู้บันทึก'},{key:'target_name',label:'ข้อมูลของ'},{key:'method',label:'คำสั่ง'},{key:'route',label:'รายการ'}],
}
const form=ref<{title:string;fields:Field[];save:(values:Record<string,unknown>)=>Promise<void>;note?:string}|null>(null)
const notice=ref(''),actionError=ref('')
function display(row:Row,key:string):string {const value=row[key];if(value==null||value==='')return '—';if(['rent','deposit','amount','water','electric','other'].includes(key))return currency(value);if(key.endsWith('_at')||['due','start_date','end_date','move_date'].includes(key))return date(value);if(['status','sign_status'].includes(key))return statusName(value);if(key==='sign_mode')return value==='paper'?'เอกสารตัวจริง':'อิเล็กทรอนิกส์';return String(value)}
async function refresh(){await client.invalidateQueries({queryKey:['admin']});if(!notice.value)notice.value='บันทึกแล้ว';actionError.value=''}
function open(title:string,fields:Field[],save:(values:Record<string,unknown>)=>Promise<void>,note?:string){notice.value='';form.value={title,fields,save:async values=>{await save(values);await refresh()},note}}
async function create(){
  const sec=section.value
  try{
    if(sec==='properties')open('เพิ่มโครงการ',[{name:'name',label:'ชื่อโครงการ'},{name:'address',label:'ที่อยู่',required:false}],v=>post('/properties',v))
    if(sec==='units'){const properties=await get<Row[]>('/properties');open('เพิ่มห้องพัก',[{name:'property_id',label:'โครงการ',type:'select',options:properties.map(p=>({value:p.id,label:String(p.name)}))},{name:'building',label:'อาคาร'},{name:'number',label:'เลขห้อง'},{name:'floor',label:'ชั้น',type:'number'},{name:'rent',label:'ค่าเช่า',type:'number'},{name:'deposit',label:'เงินประกัน',type:'number',value:'0'},{name:'owner_name',label:'ชื่อเจ้าของห้อง',required:false},{name:'owner_phone',label:'เบอร์เจ้าของห้อง',required:false}],v=>post('/units',v))}
    if(sec==='residents'){const units=(await get<Row[]>('/units')).filter(x=>x.status==='available');open('เพิ่มผู้พัก',[{name:'unit_id',label:'ห้อง',type:'select',options:units.map(x=>({value:x.id,label:`${x.building} ${x.number}`}))},{name:'name',label:'ชื่อผู้พัก'},{name:'username',label:'ชื่อผู้ใช้'}],async v=>{const result=await post<{username:string;password:string}>('/residents',v);notice.value=`บัญชีใหม่: ${result.username} / ${result.password} (บันทึกก่อนปิดหน้า)`})}
    if(sec==='contracts'){const [units,residents]=await Promise.all([get<Row[]>('/units'),get<Row[]>('/residents')]);open('สร้างสัญญาเช่า',[{name:'unit_id',label:'ห้อง',type:'select',options:units.filter(x=>x.status==='occupied').map(x=>({value:x.id,label:String(x.number)}))},{name:'user_id',label:'ผู้พัก',type:'select',options:residents.map(x=>({value:x.id,label:`${x.name} · ${x.number}`}))},{name:'start_date',label:'เริ่มสัญญา',type:'date'},{name:'end_date',label:'สิ้นสุดสัญญา',type:'date'},{name:'rent',label:'ค่าเช่า',type:'number'},{name:'deposit',label:'เงินประกัน',type:'number'},{name:'sign_mode',label:'รูปแบบลงนาม',type:'select',options:[{value:'paper',label:'เอกสารตัวจริง'},{value:'electronic',label:'อิเล็กทรอนิกส์'}]}],v=>post('/contracts',v))}
    if(sec==='billing'){const units=await get<Row[]>('/units');open('สร้างบิล',[{name:'unit_id',label:'ห้อง',type:'select',options:units.filter(x=>x.status==='occupied').map(x=>({value:x.id,label:String(x.number)}))},{name:'period',label:'งวด',type:'month'},{name:'rent',label:'ค่าเช่า',type:'number'},{name:'water',label:'ค่าน้ำ',type:'number',value:'0'},{name:'electric',label:'ค่าไฟ',type:'number',value:'0'},{name:'other',label:'อื่นๆ',type:'number',value:'0'},{name:'due',label:'ครบกำหนด',type:'date'}],v=>post('/invoices',v))}
    if(sec==='announcements')open('สร้างประกาศ',[{name:'title',label:'หัวข้อ'},{name:'body',label:'รายละเอียด',type:'textarea'},{name:'category',label:'หมวด',value:'ทั่วไป'},{name:'building',label:'อาคารเป้าหมาย (เว้นว่าง = ทุกอาคาร)',required:false},{name:'status',label:'สถานะ',type:'select',options:[{value:'published',label:'เผยแพร่ทันที'},{value:'draft',label:'ฉบับร่าง'}]}],v=>post('/announcements',v))
    if(sec==='rules')open('เพิ่มกฎระเบียบ',[{name:'title',label:'หัวข้อ'},{name:'body',label:'รายละเอียด',type:'textarea'}],v=>post('/rules',v))
    if(sec==='import')open('นำเข้าข้อมูลห้อง',[{name:'file',label:'ไฟล์ .xlsx หรือ .csv',type:'file'}],async v=>{const file=v.file as File;const parsed=await post<{filename:string;rows:Row[]}>('/import/parse',{filename:file.name,file:await fileData(file)});await post('/import/confirm',parsed)},'นำเข้าเฉพาะห้องและเจ้าของห้อง ระบบจะข้ามห้องที่มีอยู่แล้ว ข้อมูลผู้พักและเอกสารบันทึกในทะเบียนผู้พัก')
  }catch(e){actionError.value=message(e)}
}
async function act(row:Row,action:string){
  try{
    notice.value=''
    if(action==='invite'){const result=await post<{invite:string}>(`/units/${row.id}/invite`,{});notice.value=`รหัสเชิญห้อง ${row.number}: ${result.invite} (ใช้ครั้งเดียวภายใน 7 วัน)`}
    if(action==='publish-invoice')await post(`/invoices/${row.id}/publish`,{})
    if(action==='publish-announcement')await post(`/announcements/${row.id}/publish`,{})
    if(action==='maintenance'||action==='incident')await patch(`/${action==='incident'?'incidents':'maintenance'}/${row.id}`,{status:row.status==='open'?'in_progress':'done'})
    if(action==='payment-review')open('ตรวจการชำระ',[{name:'status',label:'ผลการตรวจ',type:'select',options:[{value:'verified',label:'ยืนยัน'},{value:'rejected',label:'ขอหลักฐานใหม่'}]},{name:'actual_amount',label:'ยอดรับจริง',type:'number',value:String(row.amount)},{name:'reference',label:'เลขอ้างอิงธนาคาร',required:false},{name:'note',label:'เหตุผลเมื่อปฏิเสธ',required:false},{name:'confirmed',label:'ตรวจบัญชีจริงแล้ว',type:'checkbox'}],v=>post(`/payments/${row.id}/review`,{...v,confirmed:v.confirmed===true}))
    if(action==='contract-upload')open('แนบ PDF สัญญา',[{name:'file',label:'เอกสาร PDF',type:'file'}],async v=>post(`/contracts/${row.id}/document`,{file:await fileData(v.file as File)}))
    if(action==='contract-paper')await post(`/contracts/${row.id}/paper`,{})
    if(action==='moveout'){const next=({requested:'reviewed',reviewed:'inspection',inspection:'settlement',settlement:'completed'} as Record<string,string>)[String(row.status)];if(!next)return;const fields:Field[]=next==='inspection'?[{name:'inspection_date',label:'วันนัดตรวจ',type:'date'},{name:'inspector',label:'ผู้ตรวจ'}]:next==='settlement'?[{name:'water_reading',label:'มิเตอร์น้ำ',type:'number'},{name:'electric_reading',label:'มิเตอร์ไฟ',type:'number'},{name:'cleaning_fee',label:'ค่าทำความสะอาด',type:'number',value:'0'},{name:'damage_fee',label:'ค่าเสียหาย',type:'number',value:'0'},{name:'other_fee',label:'อื่นๆ',type:'number',value:'0'},{name:'settlement_note',label:'ผลตรวจ',type:'textarea'}]:next==='completed'?[{name:'refund_reference',label:'เลขอ้างอิงคืนเงิน'}]:[];open('ดำเนินคำขอย้ายออก',fields,v=>patch(`/moveouts/${row.id}`,{...v,status:next}))}
    await refresh()
  }catch(e){actionError.value=message(e)}
}
const settings=computed(()=>overview.value)
const settingFields=[['org_name','ชื่อที่แสดง'],['office_phone','เบอร์นิติบุคคล'],['security_phone','รปภ. 24 ชั่วโมง'],['emergency_phone','เบอร์ฉุกเฉิน'],['bank_name','ธนาคาร'],['bank_account','ชื่อบัญชี'],['bank_number','เลขบัญชี'],['privacy_purpose','วัตถุประสงค์การเก็บข้อมูลผู้พัก'],['retention_days','จำนวนวันเก็บทะเบียนหลังย้ายออก'],['import_retention_days','จำนวนวันเก็บชุดข้อมูลนำเข้า']]
async function editSettings(){open('ตั้งค่าองค์กร',settingFields.map(([name,label])=>({name:name!,label:label!,value:String(settings.value[name!]||(name==='import_retention_days'?'365':'')),required:name==='privacy_purpose'||name==='retention_days'||name==='import_retention_days',type:name==='retention_days'||name==='import_retention_days'?'number':'text'})),v=>patch('/settings',v))}
async function logout(){await auth.logout();await router.replace('/login')}
let events:EventSource|undefined
onMounted(()=>{events=new EventSource('/api/events');events.addEventListener('incident',()=>client.invalidateQueries({queryKey:['admin','incidents']}))})
onUnmounted(()=>events?.close())
</script>
<template><div class="app-shell flex"><aside class="sidebar p-5 shrink-0"><div class="text-xl font-bold flex items-center gap-2 mb-2"><span class="brand-bg rounded-lg text-white p-2"><Building2 :size="20" /></span>domivra</div><p class="text-xs tracking-widest text-slate-400 mb-5">OWNER BACK OFFICE</p><p class="border rounded-xl p-3 mb-5 font-semibold">{{ auth.user?.organization }}<small class="block text-slate-500 font-normal">เจ้าของหอพัก / ผู้จัดการ</small></p><nav class="space-y-1" aria-label="เมนูผู้ดูแลหอพัก"><RouterLink v-for="item in nav" :key="item.id" :to="`/owner/${item.id}`" class="nav-item" :class="{active:section===item.id}"><component :is="item.icon" :size="18" />{{ item.label }}</RouterLink></nav></aside>
<div class="flex-1 min-w-0"><header class="bg-white border-b px-5 md:px-8 py-4 flex justify-between items-center"><strong>{{ auth.user?.organization }}</strong><Button variant="outline" class="no-print" @click="logout"><LogOut :size="16" /> ออกจากระบบ</Button></header><main class="max-w-7xl mx-auto p-5 md:p-8"><div class="flex flex-wrap justify-between gap-4 items-center mb-6"><div><h1 class="text-3xl font-bold">{{ title }}</h1><p class="text-slate-500">จัดการข้อมูลของ {{ auth.user?.organization }}</p></div><Button v-if="['properties','units','residents','contracts','billing','announcements','rules','import'].includes(section)" class="brand-bg text-white no-print" @click="create"><Plus :size="16" /> {{ section==='import'?'นำเข้าข้อมูล':'เพิ่มรายการ' }}</Button><Button v-if="section==='settings'" class="brand-bg text-white" @click="editSettings">แก้ไขการตั้งค่า</Button></div>
<p v-if="actionError" class="error-text mb-4" role="alert">{{ actionError }}</p><p v-if="notice" class="p-3 rounded-lg bg-emerald-50 text-emerald-800 mb-4 whitespace-pre-wrap">{{ notice }}</p><p v-if="section!=='datasets'&&loadError" class="error-text">{{ message(loadError) }}</p><p v-if="section!=='datasets'&&isPending" class="text-slate-500">กำลังโหลด…</p>
<DatasetManager v-if="section==='datasets'" />
<div v-else-if="section==='overview'||section==='reports'" class="grid md:grid-cols-4 gap-4"><div v-for="metric in [{label:'ห้องทั้งหมด',value:(overview.units as Record<string,unknown>)?.total||0},{label:'ห้องที่มีผู้พัก',value:(overview.units as Record<string,unknown>)?.occupied||0},{label:'รายรับตรวจแล้ว',value:currency((overview.revenue as Record<string,unknown>)?.total)},{label:'ยอดค้างชำระ',value:currency((overview.outstanding as Record<string,unknown>)?.total)}]" :key="metric.label" class="metric"><p class="text-slate-500 text-sm">{{ metric.label }}</p><strong class="text-2xl">{{ metric.value }}</strong></div></div>
<Card v-else-if="section==='settings'"><CardHeader><CardTitle>ข้อมูลติดต่อ รับชำระ และความเป็นส่วนตัว</CardTitle></CardHeader><CardContent><div v-for="[key,label] in settingFields" :key="key" class="border-b py-3 flex justify-between gap-4"><span>{{ label }}</span><strong class="text-right">{{ settings[key]|| (key==='import_retention_days'?'365':'ยังไม่ได้ตั้งค่า') }}</strong></div><p class="text-sm text-slate-500 mt-3">ระยะเก็บทะเบียนเริ่มนับเมื่อปิดคำขอย้ายออก ส่วนชุดข้อมูลนำเข้าเริ่มนับตั้งแต่วันที่นำเข้า</p></CardContent></Card>
<Card v-else-if="section==='insights'"><CardHeader><CardTitle>รายการที่ควรตรวจสอบ</CardTitle></CardHeader><CardContent><p>{{ overview.summary||'ยังไม่มีผลวิเคราะห์' }}</p><div v-for="anomaly in (overview.anomalies as Record<string,unknown>[] || [])" :key="String(anomaly.kind)" class="border-t py-3">{{ anomaly.explanation }}</div><p class="text-sm text-slate-500">ระบบตรวจความผิดปกติด้วยกฎก่อนส่งคำอธิบายจากผู้ให้บริการ AI</p></CardContent></Card>
<Card v-else><CardContent class="pt-5 table-wrap"><Table><TableHeader><TableRow><TableHead v-for="column in columns[section]||[]" :key="column.key">{{ column.label }}</TableHead><TableHead>ดำเนินการ</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="row in list" :key="row.id"><TableCell v-for="column in columns[section]||[]" :key="column.key">{{ display(row,column.key) }}</TableCell><TableCell><div class="flex flex-wrap gap-2">
  <Button v-if="section==='units'&&row.status==='available'" size="sm" variant="outline" @click="act(row,'invite')">รหัสเชิญ</Button>
  <RouterLink v-if="section==='residents'" :to="`/owner/residents/${row.id}`" class="brand text-sm font-semibold">ทะเบียนผู้พัก</RouterLink>
  <Button v-if="section==='billing'&&row.status==='draft'" size="sm" variant="outline" @click="act(row,'publish-invoice')">เผยแพร่</Button>
  <Button v-if="section==='announcements'&&row.status==='draft'" size="sm" variant="outline" @click="act(row,'publish-announcement')">เผยแพร่</Button>
  <Button v-if="section==='payments'&&row.status==='pending'" size="sm" variant="outline" @click="act(row,'payment-review')">ตรวจรายการ</Button><a v-if="section==='payments'" :href="`/api/evidence/${row.id}`" target="_blank" rel="noopener" class="brand text-sm">หลักฐาน</a>
  <Button v-if="section==='maintenance'&&row.status!=='done'" size="sm" variant="outline" @click="act(row,'maintenance')">{{ row.status==='open'?'รับเรื่อง':'เสร็จแล้ว' }}</Button>
  <Button v-if="section==='incidents'&&row.status!=='done'" size="sm" variant="outline" @click="act(row,'incident')">{{ row.status==='open'?'รับเรื่อง':'เสร็จแล้ว' }}</Button>
  <Button v-if="section==='moveouts'&&row.status!=='completed'" size="sm" variant="outline" @click="act(row,'moveout')">ขั้นถัดไป</Button>
  <Button v-if="section==='contracts'&&row.sign_status!=='signed'" size="sm" variant="outline" @click="act(row,'contract-upload')">แนบ PDF</Button>
  <Button v-if="section==='contracts'&&row.sign_mode==='paper'&&row.document_key&&row.sign_status!=='signed'" size="sm" variant="outline" @click="act(row,'contract-paper')">รับฉบับจริง</Button>
  <a v-if="section==='contracts'&&row.document_key" :href="`/api/contracts/${row.id}/file`" target="_blank" rel="noopener" class="brand text-sm">ดู PDF</a>
  <a v-if="section==='contracts'&&row.sign_status==='signed'" :href="`/api/contracts/${row.id}/signature`" target="_blank" rel="noopener" class="brand text-sm">หลักฐานลงนาม</a>
</div></TableCell></TableRow></TableBody></Table><p v-if="!list.length&&!isPending" class="text-center text-slate-500 py-8">ยังไม่มีข้อมูล</p></CardContent></Card>
</main></div><FormDialog v-if="form" :title="form.title" :fields="form.fields" :save="form.save" :note="form.note" @close="form=null" /></div></template>
