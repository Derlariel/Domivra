<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { ArrowLeft, Plus, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import FormDialog, { type Field } from '@/components/FormDialog.vue'
import { get, post, patch, fileData, message, date, type Row } from '@/lib/api'

type Occupant={name:string;relationship:string}
type Pet={type:string;count:number}
type Vehicle={plate:string;parking:string}
type AccessItem={code:string;issued_at:string;returned_at:string}
type Authorized={name:string;phone:string}
type ProfileInput={
  nationality:string;phone:string;email:string;line_id:string;
  emergency_name:string;emergency_relationship:string;emergency_phone:string;
  occupants:Occupant[];pets:Pet[];vehicles:Vehicle[];access_items:AccessItem[];authorized_people:Authorized[];
  move_in_date:string;
}
type Profile=Partial<ProfileInput> & {
  user_id:string;unit_id:string|null;name:string;username:string;number:string|null;building:string|null;floor:number|null;
  owner_name:string|null;owner_phone:string|null;start_date:string|null;end_date:string|null;rent:string|null;deposit:string|null;
  identity_masked:string;identity_type:string;has_visa:boolean;has_identity_document:boolean;has_authorization_document:boolean;
  move_out_date:string|null;consent_at:string|null;retention_at:string|null;
}
type History={inspections:Row[];visitors:Row[];complaints:Row[];maintenance:Row[]}
const route=useRoute(),router=useRouter(),residentId=computed(()=>String(route.params.id))
const {data:profile,refetch:reload}=useQuery({queryKey:computed(()=>['registry',residentId.value]),queryFn:()=>get<Profile>(`/residents/${residentId.value}/profile`)})
const {data:history,refetch:reloadHistory}=useQuery({queryKey:computed(()=>['registry-history',residentId.value]),queryFn:()=>get<History>(`/residents/${residentId.value}/registry-history`)})
const blank=():ProfileInput=>({nationality:'',phone:'',email:'',line_id:'',emergency_name:'',emergency_relationship:'',emergency_phone:'',
  occupants:[],pets:[],vehicles:[],access_items:[],authorized_people:[],move_in_date:''})
const form=ref<ProfileInput>(blank()),ownerName=ref(''),ownerPhone=ref(''),notice=ref(''),error=ref(''),busy=ref(false),revealed=ref('')
const dialog=ref<{title:string;fields:Field[];save:(values:Record<string,unknown>)=>Promise<void>}|null>(null)
watch(profile,value=>{if(!value)return;form.value={...blank(),...Object.fromEntries(Object.keys(blank()).map(k=>[k,(value as Record<string,unknown>)[k]??(blank() as unknown as Record<string,unknown>)[k]]))} as ProfileInput
  form.value.move_in_date=String(value.move_in_date||'').slice(0,10)
  form.value.access_items=form.value.access_items.map(item=>({...item,issued_at:String(item.issued_at||'').slice(0,10),returned_at:String(item.returned_at||'').slice(0,10)}))
  ownerName.value=value.owner_name||'';ownerPhone.value=value.owner_phone||''
},{immediate:true})
async function saveProfile(){try{busy.value=true;error.value='';await patch(`/residents/${residentId.value}/profile`,form.value);notice.value='บันทึกทะเบียนผู้พักแล้ว';await reload()}catch(e){error.value=message(e)}finally{busy.value=false}}
async function saveOwner(){try{if(!profile.value?.unit_id)return;busy.value=true;error.value='';await patch(`/units/${profile.value.unit_id}/owner`,{owner_name:ownerName.value,owner_phone:ownerPhone.value});notice.value='บันทึกเจ้าของห้องแล้ว';await reload()}catch(e){error.value=message(e)}finally{busy.value=false}}
async function upload(kind:'identity'|'authorization',event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;try{error.value='';await post(`/residents/${residentId.value}/documents/${kind}`,{file:await fileData(file)});notice.value='เก็บเอกสารในพื้นที่ส่วนตัวแล้ว';await reload()}catch(e){error.value=message(e)}finally{(event.target as HTMLInputElement).value=''}}
function editIdentity(){dialog.value={title:'บันทึกเลขเอกสารระบุตัวตน',fields:[
  {name:'type',label:'ชนิดเอกสาร',type:'select',options:[{value:'thai_id',label:'บัตรประชาชนไทย'},{value:'passport',label:'พาสปอร์ต'}]},
  {name:'number',label:'เลขบัตรประชาชนหรือพาสปอร์ต'},{name:'visa_number',label:'เลขวีซ่า (ถ้ามี)',required:false},
  {name:'visa_expiry',label:'วันหมดอายุวีซ่า (ถ้ามี)',type:'date',required:false},
],save:async values=>{await post(`/residents/${residentId.value}/identity`,values);notice.value='บันทึกเลขเอกสารแบบเข้ารหัสแล้ว';await reload()}}}
async function reveal(){try{error.value='';const result=await get<{number:string;visa_number:string}>(`/residents/${residentId.value}/identity`);revealed.value=`เลขเอกสาร: ${result.number}${result.visa_number?' · วีซ่า: '+result.visa_number:''}`}catch(e){error.value=message(e)}}
function historyDialog(kind:'inspection'|'visitor'|'complaint'){
  const fields:Field[]=kind==='inspection'?[{name:'kind',label:'ประเภท',type:'select',options:[{value:'move_in',label:'ก่อนย้ายเข้า'},{value:'move_out',label:'ก่อนย้ายออก'},{value:'other',label:'ตรวจเพิ่มเติม'}]},{name:'inspected_at',label:'วันและเวลาตรวจ',type:'datetime-local'},{name:'condition_note',label:'ผลตรวจสภาพห้อง',type:'textarea'}]:
    kind==='visitor'?[{name:'visitor_name',label:'ชื่อผู้มาติดต่อ'},{name:'purpose',label:'วัตถุประสงค์',required:false},{name:'entered_at',label:'วันและเวลาเข้า',type:'datetime-local'},{name:'left_at',label:'วันและเวลาออก',type:'datetime-local',required:false}]:
    [{name:'subject',label:'หัวข้อร้องเรียน'},{name:'detail',label:'รายละเอียด',type:'textarea'}]
  const path=kind==='inspection'?'inspections':kind==='visitor'?'visitors':'complaints'
  dialog.value={title:kind==='inspection'?'บันทึกตรวจสภาพห้อง':kind==='visitor'?'บันทึกผู้มาติดต่อ':'บันทึกคำร้องเรียน',fields,save:async values=>{
    const data={...values}
    for(const key of ['inspected_at','entered_at','left_at'])if(data[key])data[key]=new Date(String(data[key])).toISOString()
    await post(`/residents/${residentId.value}/${path}`,data);notice.value='บันทึกรายการแล้ว';await reloadHistory()
  }}
}
</script>
<template><main class="max-w-6xl mx-auto p-5 md:p-8 space-y-5"><Button variant="outline" @click="router.push('/owner/residents')"><ArrowLeft :size="16" /> กลับรายชื่อผู้พัก</Button>
  <div><h1 class="text-3xl font-bold">ทะเบียนผู้พัก: {{ profile?.name||'กำลังโหลด…' }}</h1><p class="text-slate-500">ห้อง {{ profile?.number||'—' }} · อาคาร {{ profile?.building||'—' }} · ชั้น {{ profile?.floor??'—' }}</p></div>
  <p v-if="error" class="error-text" role="alert">{{ error }}</p><p v-if="notice" class="p-3 rounded-lg bg-emerald-50 text-emerald-800" role="status">{{ notice }}</p>
  <Card><CardHeader><CardTitle>สถานะข้อมูลส่วนตัว</CardTitle></CardHeader><CardContent><p>ผู้พักรับทราบและยืนยัน: <strong>{{ profile?.consent_at?date(profile.consent_at):'ยังไม่ยืนยัน' }}</strong></p><p v-if="profile?.retention_at" class="text-sm text-slate-500 mt-2">ลบทะเบียนและเอกสารส่วนตัวตามนโยบาย: {{ date(profile.retention_at) }}</p><p v-if="!profile?.consent_at" class="text-sm text-amber-700 mt-2">ให้ผู้พักเข้าหน้า “บัญชีของฉัน” เพื่ออ่านประกาศและยืนยันก่อนบันทึกทะเบียน/เอกสาร</p></CardContent></Card>
  <Card><CardHeader><CardTitle>ตัวตนและการติดต่อ</CardTitle></CardHeader><CardContent class="grid md:grid-cols-3 gap-4">
    <div><Label>ชื่อ-นามสกุล</Label><p class="py-2">{{ profile?.name }}</p></div>
    <div><Label for="nationality">สัญชาติ</Label><Input id="nationality" v-model="form.nationality" /></div>
    <div><Label>ชื่อผู้ใช้</Label><p class="py-2">{{ profile?.username }}</p></div>
    <div><Label for="phone">โทรศัพท์</Label><Input id="phone" v-model="form.phone" type="tel" /></div>
    <div><Label for="email">อีเมล</Label><Input id="email" v-model="form.email" type="email" /></div>
    <div><Label for="line">LINE ID</Label><Input id="line" v-model="form.line_id" /></div>
    <div><Label for="emergency-name">ผู้ติดต่อฉุกเฉิน</Label><Input id="emergency-name" v-model="form.emergency_name" /></div>
    <div><Label for="emergency-relation">ความสัมพันธ์</Label><Input id="emergency-relation" v-model="form.emergency_relationship" /></div>
    <div><Label for="emergency-phone">เบอร์ฉุกเฉิน</Label><Input id="emergency-phone" v-model="form.emergency_phone" type="tel" /></div>
  </CardContent></Card>
  <Card><CardHeader><CardTitle>เอกสารระบุตัวตน</CardTitle></CardHeader><CardContent class="space-y-3"><p>เลขบัตร/พาสปอร์ต: <strong>{{ profile?.identity_masked||'ยังไม่มี' }}</strong><span v-if="profile?.has_visa"> · มีข้อมูลวีซ่า</span></p><div class="flex flex-wrap gap-2"><Button variant="outline" @click="editIdentity">บันทึกเลขเอกสาร</Button><Button v-if="profile?.identity_masked" variant="outline" @click="revealed?revealed='':reveal()">{{ revealed?'ปิดเลขเต็ม':'ดูเลขเต็ม' }}</Button></div><p v-if="revealed" class="rounded-lg bg-amber-50 p-3 font-mono break-all" role="status">{{ revealed }}</p>
    <div class="grid md:grid-cols-2 gap-4"><div><Label for="identity-file">สำเนาบัตรหรือพาสปอร์ต (PDF/PNG/JPG)</Label><input id="identity-file" type="file" accept=".pdf,.png,.jpg,.jpeg" class="block mt-2" @change="upload('identity',$event)" /><a v-if="profile?.has_identity_document" :href="`/api/residents/${residentId}/documents/identity`" target="_blank" rel="noopener" class="brand text-sm">ดูเอกสาร</a></div><div><Label for="authorization-file">หนังสือมอบอำนาจ (ถ้ามี)</Label><input id="authorization-file" type="file" accept=".pdf,.png,.jpg,.jpeg" class="block mt-2" @change="upload('authorization',$event)" /><a v-if="profile?.has_authorization_document" :href="`/api/residents/${residentId}/documents/authorization`" target="_blank" rel="noopener" class="brand text-sm">ดูเอกสาร</a></div></div>
  </CardContent></Card>
  <Card><CardHeader><CardTitle>ห้อง เจ้าของ และสัญญา</CardTitle></CardHeader><CardContent class="space-y-4"><p>ห้อง {{ profile?.number||'—' }} · อาคาร {{ profile?.building||'—' }} · ชั้น {{ profile?.floor??'—' }}</p><p>สัญญา {{ profile?.start_date?date(profile.start_date):'—' }} – {{ profile?.end_date?date(profile.end_date):'—' }} · ค่าเช่า {{ profile?.rent||'—' }} · เงินมัดจำ {{ profile?.deposit||'—' }}</p><div class="grid md:grid-cols-2 gap-4"><div><Label for="owner-name">ชื่อเจ้าของห้อง</Label><Input id="owner-name" v-model="ownerName" /></div><div><Label for="owner-phone">เบอร์เจ้าของห้อง</Label><Input id="owner-phone" v-model="ownerPhone" type="tel" /></div></div><Button variant="outline" :disabled="!profile?.unit_id||busy" @click="saveOwner">บันทึกเจ้าของห้อง</Button><p class="text-sm text-slate-500">สำเนาสัญญาเช่าจัดการในเมนู “สัญญาเช่า”</p></CardContent></Card>
  <Card><CardHeader><CardTitle>ผู้ร่วมพักและสัตว์เลี้ยง</CardTitle></CardHeader><CardContent class="space-y-4"><p>จำนวนผู้พักอาศัย: {{ 1+form.occupants.length }} คน (รวมผู้ถือบัญชี)</p><div v-for="(item,index) in form.occupants" :key="index" class="grid grid-cols-[1fr_1fr_auto] gap-2"><Input v-model="item.name" aria-label="ชื่อผู้ร่วมพัก" placeholder="ชื่อผู้ร่วมพัก" /><Input v-model="item.relationship" aria-label="ความสัมพันธ์ผู้ร่วมพัก" placeholder="ความสัมพันธ์" /><Button variant="outline" aria-label="ลบผู้ร่วมพัก" @click="form.occupants.splice(index,1)"><Trash2 :size="16" /></Button></div><Button variant="outline" @click="form.occupants.push({name:'',relationship:''})"><Plus :size="16" /> เพิ่มผู้ร่วมพัก</Button>
    <div v-for="(item,index) in form.pets" :key="index" class="grid grid-cols-[1fr_120px_auto] gap-2"><Input v-model="item.type" aria-label="ชนิดสัตว์เลี้ยง" placeholder="ชนิดสัตว์" /><Input v-model.number="item.count" aria-label="จำนวนสัตว์เลี้ยง" type="number" min="1" /><Button variant="outline" aria-label="ลบสัตว์เลี้ยง" @click="form.pets.splice(index,1)"><Trash2 :size="16" /></Button></div><Button variant="outline" @click="form.pets.push({type:'',count:1})"><Plus :size="16" /> เพิ่มสัตว์เลี้ยง</Button></CardContent></Card>
  <Card><CardHeader><CardTitle>รถ บัตรผ่าน และผู้ได้รับอนุญาต</CardTitle></CardHeader><CardContent class="space-y-4"><div v-for="(item,index) in form.vehicles" :key="index" class="grid grid-cols-[1fr_1fr_auto] gap-2"><Input v-model="item.plate" aria-label="ทะเบียนรถ" placeholder="ทะเบียนรถ" /><Input v-model="item.parking" aria-label="ช่องจอด" placeholder="ช่องจอด" /><Button variant="outline" aria-label="ลบรถ" @click="form.vehicles.splice(index,1)"><Trash2 :size="16" /></Button></div><Button variant="outline" @click="form.vehicles.push({plate:'',parking:''})"><Plus :size="16" /> เพิ่มรถ</Button>
    <div v-for="(item,index) in form.access_items" :key="index" class="grid md:grid-cols-[1fr_1fr_1fr_auto] gap-2"><Input v-model="item.code" aria-label="เลขคีย์การ์ดหรือสติกเกอร์" placeholder="เลขบัตร/สติกเกอร์" /><Input v-model="item.issued_at" aria-label="วันที่รับบัตร" type="date" /><Input v-model="item.returned_at" aria-label="วันที่คืนบัตร" type="date" /><Button variant="outline" aria-label="ลบบัตร" @click="form.access_items.splice(index,1)"><Trash2 :size="16" /></Button></div><Button variant="outline" @click="form.access_items.push({code:'',issued_at:'',returned_at:''})"><Plus :size="16" /> เพิ่มบัตรผ่าน</Button>
    <div v-for="(item,index) in form.authorized_people" :key="index" class="grid grid-cols-[1fr_1fr_auto] gap-2"><Input v-model="item.name" aria-label="ชื่อผู้ได้รับอนุญาต" placeholder="ชื่อผู้ได้รับอนุญาต" /><Input v-model="item.phone" aria-label="เบอร์ผู้ได้รับอนุญาต" placeholder="เบอร์ติดต่อ" /><Button variant="outline" aria-label="ลบผู้ได้รับอนุญาต" @click="form.authorized_people.splice(index,1)"><Trash2 :size="16" /></Button></div><Button variant="outline" @click="form.authorized_people.push({name:'',phone:''})"><Plus :size="16" /> เพิ่มผู้ได้รับอนุญาต</Button></CardContent></Card>
  <Card><CardHeader><CardTitle>วันย้ายเข้าและย้ายออก</CardTitle></CardHeader><CardContent class="grid md:grid-cols-2 gap-4"><div><Label for="move-in">วันที่ย้ายเข้า</Label><Input id="move-in" v-model="form.move_in_date" type="date" /></div><div><Label>วันที่ย้ายออก</Label><p class="pt-2">{{ profile?.move_out_date?date(profile.move_out_date):'ยังไม่ย้ายออก' }}</p><p class="text-sm text-slate-500">บันทึกเมื่อปิดขั้นตอนย้ายออก</p></div></CardContent></Card>
  <Button class="brand-bg text-white" :disabled="busy||!profile?.consent_at" @click="saveProfile">บันทึกทะเบียนผู้พัก</Button>
  <Card><CardHeader><CardTitle>ประวัติการดำเนินงาน</CardTitle></CardHeader><CardContent class="space-y-5"><div class="flex flex-wrap gap-2"><Button variant="outline" @click="historyDialog('inspection')">เพิ่มผลตรวจห้อง</Button><Button variant="outline" @click="historyDialog('visitor')">บันทึกผู้มาติดต่อ</Button><Button variant="outline" @click="historyDialog('complaint')">บันทึกคำร้องเรียน</Button></div>
    <section><h3 class="font-semibold">ตรวจสภาพห้อง</h3><p v-for="row in history?.inspections||[]" :key="row.id" class="border-b py-2">{{ date(row.inspected_at) }} · {{ row.condition_note }} · {{ row.recorded_by_name }}</p><p v-if="!history?.inspections.length" class="text-slate-500">ยังไม่มีข้อมูล</p></section>
    <section><h3 class="font-semibold">ผู้มาติดต่อ</h3><p v-for="row in history?.visitors||[]" :key="row.id" class="border-b py-2">{{ date(row.entered_at) }} · {{ row.visitor_name }} · {{ row.purpose }} · {{ row.recorded_by_name }}</p><p v-if="!history?.visitors.length" class="text-slate-500">ยังไม่มีข้อมูล</p></section>
    <section><h3 class="font-semibold">ร้องเรียน</h3><p v-for="row in history?.complaints||[]" :key="row.id" class="border-b py-2">{{ date(row.created_at) }} · {{ row.subject }} · {{ row.detail }} · {{ row.recorded_by_name }}</p><p v-if="!history?.complaints.length" class="text-slate-500">ยังไม่มีข้อมูล</p></section>
    <section><h3 class="font-semibold">แจ้งซ่อม</h3><p v-for="row in history?.maintenance||[]" :key="row.id" class="border-b py-2">{{ date(row.created_at) }} · {{ row.subject }} · {{ row.status }}</p><p v-if="!history?.maintenance.length" class="text-slate-500">ยังไม่มีข้อมูล</p></section>
  </CardContent></Card>
  <FormDialog v-if="dialog" :title="dialog.title" :fields="dialog.fields" :save="dialog.save" @close="dialog=null" />
</main></template>
