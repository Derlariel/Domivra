<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { get, post, api, fileData, message, date } from '@/lib/api'

type Sheet={name:string;headers:string[];rows:string[][]}
type Parsed={filename:string;sheets:Sheet[]}
type Dataset={id:string;name:string;filename:string;row_count:number;created_at:string;expires_at:string}
type Detail=Dataset&{headers:string[];rows:{row_number:number;values:string[]}[]}
type Target='units'|'residents'|'contracts'|'invoices'
type MappingResult={created:number;skipped:number;error_count:number;errors:{row:number;message:string}[];credentials?:{room:string;name:string;username:string;password:string}[]}
const targets:{id:Target;label:string}[]=[{id:'units',label:'ห้องพัก'},{id:'residents',label:'บัญชีผู้พัก'},{id:'contracts',label:'สัญญาเช่า'},{id:'invoices',label:'บิลฉบับร่าง'}]
const fields:Record<Target,{key:string;label:string;required?:boolean}[]>={
  units:[{key:'number',label:'เลขห้อง',required:true},{key:'property',label:'โครงการ'},{key:'building',label:'อาคาร'},{key:'floor',label:'ชั้น'},{key:'rent',label:'ค่าเช่า'},{key:'deposit',label:'เงินประกัน'},{key:'area',label:'พื้นที่'},{key:'room_type',label:'ประเภทห้อง'},{key:'owner_name',label:'เจ้าของห้อง'},{key:'owner_phone',label:'เบอร์เจ้าของห้อง'}],
  residents:[{key:'number',label:'เลขห้อง',required:true},{key:'property',label:'โครงการ'},{key:'building',label:'อาคาร'},{key:'name',label:'ชื่อผู้พัก',required:true},{key:'username',label:'ชื่อผู้ใช้'}],
  contracts:[{key:'number',label:'เลขห้อง',required:true},{key:'property',label:'โครงการ'},{key:'building',label:'อาคาร'},{key:'start_date',label:'วันเริ่มสัญญา',required:true},{key:'end_date',label:'วันสิ้นสุดสัญญา',required:true},{key:'rent',label:'ค่าเช่า'},{key:'deposit',label:'เงินประกัน'},{key:'sign_mode',label:'รูปแบบสัญญา (paper/electronic)'}],
  invoices:[{key:'number',label:'เลขห้อง',required:true},{key:'property',label:'โครงการ'},{key:'building',label:'อาคาร'},{key:'period',label:'งวดบิล YYYY-MM',required:true},{key:'due',label:'วันครบกำหนด YYYY-MM-DD',required:true},{key:'rent',label:'ค่าเช่า'},{key:'water',label:'ค่าน้ำ'},{key:'electric',label:'ค่าไฟ'},{key:'other',label:'อื่นๆ'}],
}
const client=useQueryClient(),file=ref<File|null>(null),preview=ref<Parsed|null>(null),selected=ref(''),offset=ref(0),busy=ref(false),error=ref(''),notice=ref('')
const target=ref<Target>('units'),mapping=ref<Record<string,string>>({}),mappingPreview=ref<MappingResult|null>(null)
const latestCredentials=ref<NonNullable<MappingResult['credentials']>>([])
const mappingFields=computed(()=>fields[target.value])
const {data:datasets}=useQuery({queryKey:['datasets'],queryFn:()=>get<Dataset[]>('/datasets')})
const {data:detail,isFetching}=useQuery({queryKey:computed(()=>['dataset',selected.value,offset.value]),queryFn:()=>get<Detail>(`/datasets/${selected.value}?offset=${offset.value}`),enabled:computed(()=>!!selected.value)})
async function parse(){if(!file.value)return;try{busy.value=true;error.value='';notice.value='';preview.value=await post<Parsed>('/datasets/parse',{filename:file.value.name,file:await fileData(file.value)})}catch(e){error.value=message(e)}finally{busy.value=false}}
async function confirm(){if(!preview.value)return;try{busy.value=true;error.value='';const result=await post<{ids:string[];datasets:number;rows:number}>('/datasets/confirm',preview.value);preview.value=null;file.value=null;notice.value=`นำเข้า ${result.datasets} ตาราง รวม ${result.rows} แถวแล้ว`;await client.invalidateQueries({queryKey:['datasets']});selected.value=result.ids[0]||'';offset.value=0}catch(e){error.value=message(e)}finally{busy.value=false}}
function open(id:string){selected.value=id;offset.value=0;error.value='';mappingPreview.value=null}
async function remove(item:Dataset){if(!window.confirm(`ลบชุดข้อมูล “${item.name}” และทุกแถวอย่างถาวร?`))return;try{error.value='';await api.delete(`/datasets/${item.id}`);if(selected.value===item.id)selected.value='';notice.value='ลบชุดข้อมูลแล้ว';await client.invalidateQueries({queryKey:['datasets']})}catch(e){error.value=message(e)}}
function suggest(headers:string[]){for(const field of fields[target.value]){const guess=headers.find(header=>header.toLowerCase()===field.key);if(guess)mapping.value[field.key]=guess}}
watch([selected,target],()=>{mappingPreview.value=null;mapping.value={};if(detail.value?.id===selected.value)suggest(detail.value.headers)})
watch(detail,dataset=>{if(dataset?.id===selected.value&&!Object.keys(mapping.value).length)suggest(dataset.headers)})
async function checkMapping(){if(!selected.value)return;try{busy.value=true;error.value='';mappingPreview.value=await post<MappingResult>(`/datasets/${selected.value}/mapping/preview`,{target:target.value,mapping:mapping.value})}catch(e){error.value=message(e)}finally{busy.value=false}}
function downloadCredentials(items:NonNullable<MappingResult['credentials']>){if(!items.length)return;const cell=(value:string)=>'"'+(/^[=+\-@]/.test(value)?"'":'')+value.replaceAll('"','""')+'"'
  const lines=[['room','name','username','password'],...items.map(item=>[item.room,item.name,item.username,item.password])].map(row=>row.map(cell).join(','))
  const url=URL.createObjectURL(new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'})),link=document.createElement('a')
  link.href=url;link.download='domivra-resident-credentials.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
async function applyMapping(){if(!selected.value||!mappingPreview.value||mappingPreview.value.error_count||!mappingPreview.value.created)return
  if(!window.confirm(`สร้าง ${mappingPreview.value.created} รายการในระบบจริง?`))return
  try{busy.value=true;error.value='';const result=(await api.post<MappingResult>(`/datasets/${selected.value}/mapping/confirm`,{target:target.value,mapping:mapping.value},{timeout:600000})).data
    latestCredentials.value=result.credentials||[];downloadCredentials(latestCredentials.value);notice.value=`สร้าง ${result.created} รายการ ข้ามรายการเดิม ${result.skipped} รายการแล้ว${latestCredentials.value.length?' · กรุณาเก็บไฟล์รหัสผู้พักให้ปลอดภัย':''}`
    mappingPreview.value=null;await client.invalidateQueries({queryKey:['admin']})
  }catch(e){error.value=message(e)}finally{busy.value=false}}
</script>

<template>
  <div class="space-y-5">
    <Card><CardHeader><CardTitle>นำเข้าข้อมูลของหอพัก</CardTitle></CardHeader><CardContent class="space-y-3">
      <p class="text-slate-600">ใช้ไฟล์ CSV หรือ Excel หัวตารางและคอลัมน์จะแสดงตามไฟล์ของคุณ แต่ละแผ่นงานใน Excel จะเป็นหนึ่งตาราง</p>
      <p class="text-sm text-slate-500">ไม่เกิน 4 MB, 20 แผ่นงาน, 200 คอลัมน์ และ 5,000 แถวต่อไฟล์ ข้อมูลต้นทางแยกจากงานห้องและบิลจนกว่าจะเลือกคอลัมน์ ตรวจผล และยืนยันนำเข้า</p>
      <p class="text-sm text-amber-700">ชุดข้อมูลต้นทางจะลบอัตโนมัติตามจำนวนวันที่หอพักตั้งไว้ (ค่าเริ่มต้น 365 วัน) หรือลบเองได้ก่อนกำหนด</p>
      <div class="flex flex-wrap items-center gap-3"><input type="file" accept=".csv,.xlsx" aria-label="เลือกไฟล์ข้อมูล" @change="file=($event.target as HTMLInputElement).files?.[0]||null;preview=null" /><Button :disabled="!file||busy" @click="parse">ดูตัวอย่างก่อนนำเข้า</Button></div>
    </CardContent></Card>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p><p v-if="notice" class="p-3 rounded-lg bg-emerald-50 text-emerald-800">{{ notice }}</p><Button v-if="latestCredentials.length" variant="outline" @click="downloadCredentials(latestCredentials)">ดาวน์โหลดรหัสผู้พักอีกครั้ง</Button>
    <Card v-if="preview"><CardHeader><CardTitle>ตรวจข้อมูลจาก {{ preview.filename }}</CardTitle></CardHeader><CardContent class="space-y-4">
      <div v-for="sheet in preview.sheets" :key="sheet.name" class="border rounded-lg p-3"><strong>{{ sheet.name }}</strong><p class="text-sm text-slate-600">{{ sheet.rows.length }} แถว · {{ sheet.headers.length }} คอลัมน์</p><div class="overflow-x-auto mt-2"><table class="text-sm min-w-full"><thead><tr><th v-for="header in sheet.headers" :key="header" class="border px-3 py-2 text-left whitespace-nowrap">{{ header }}</th></tr></thead><tbody><tr v-for="(row,index) in sheet.rows.slice(0,3)" :key="index"><td v-for="(cell,i) in row" :key="i" class="border px-3 py-2 whitespace-nowrap">{{ cell||'—' }}</td></tr></tbody></table></div></div>
      <Button :disabled="busy" @click="confirm">ยืนยันนำเข้าทุกตาราง</Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>ชุดข้อมูลที่นำเข้าแล้ว</CardTitle></CardHeader><CardContent><div v-if="!datasets?.length" class="text-slate-500">ยังไม่มีชุดข้อมูล</div><div v-for="item in datasets||[]" :key="item.id" class="border-b py-3 flex flex-wrap items-center justify-between gap-3"><button class="text-left brand font-semibold" @click="open(item.id)">{{ item.name }} <span class="text-slate-500 font-normal">· {{ item.row_count }} แถว · {{ item.filename }} · ลบต้นทาง {{ date(item.expires_at) }}</span></button><Button size="sm" variant="outline" @click="remove(item)">ลบชุดข้อมูล</Button></div></CardContent></Card>
    <Card v-if="selected"><CardHeader><CardTitle>{{ detail?.name||'กำลังโหลด…' }}</CardTitle></CardHeader><CardContent><p v-if="isFetching" class="text-slate-500">กำลังโหลดข้อมูล…</p><div v-if="detail" class="overflow-x-auto"><table class="text-sm min-w-full"><thead><tr><th class="border px-3 py-2 text-left">แถว</th><th v-for="(header,i) in detail.headers" :key="i" class="border px-3 py-2 text-left whitespace-nowrap">{{ header }}</th></tr></thead><tbody><tr v-for="row in detail.rows" :key="row.row_number"><td class="border px-3 py-2">{{ row.row_number }}</td><td v-for="(cell,i) in row.values" :key="i" class="border px-3 py-2 whitespace-nowrap">{{ cell||'—' }}</td></tr></tbody></table></div><div v-if="detail" class="flex items-center gap-3 mt-4"><Button variant="outline" :disabled="offset===0" @click="offset=Math.max(0,offset-100)">ก่อนหน้า</Button><span>{{ offset+1 }}–{{ Math.min(offset+100,detail.row_count) }} จาก {{ detail.row_count }}</span><Button variant="outline" :disabled="offset+100>=detail.row_count" @click="offset+=100">ถัดไป</Button></div></CardContent></Card>
    <Card v-if="detail"><CardHeader><CardTitle>เชื่อมคอลัมน์กับระบบจริง</CardTitle></CardHeader><CardContent class="space-y-4">
      <p class="text-sm text-slate-600">เลือกประเภทข้อมูลและจับคู่คอลัมน์ของไฟล์กับข้อมูลที่ระบบใช้ ตรวจผลก่อนสร้างรายการจริง ข้อมูลต้นทางยังอยู่จนถึงวันลบที่กำหนด</p>
      <div><label for="mapping-target" class="font-medium">นำเข้าเป็น</label><select id="mapping-target" v-model="target" class="block border rounded-lg px-3 py-2 mt-1"><option v-for="item in targets" :key="item.id" :value="item.id">{{ item.label }}</option></select></div>
      <div class="grid md:grid-cols-2 gap-3"><div v-for="field in mappingFields" :key="field.key"><label :for="`map-${field.key}`" class="block text-sm font-medium mb-1">{{ field.label }}{{ field.required?' *':'' }}</label><select :id="`map-${field.key}`" v-model="mapping[field.key]" class="w-full border rounded-lg px-3 py-2" @change="mappingPreview=null"><option value="">ไม่ใช้คอลัมน์นี้</option><option v-for="header in detail.headers" :key="header" :value="header">{{ header }}</option></select></div></div>
      <p v-if="target==='residents'" class="text-sm text-amber-700">ระบบจะสร้างรหัสผ่านเฉพาะคนและดาวน์โหลดไฟล์รหัสให้ครั้งเดียว ผู้พักต้องยืนยันการเก็บข้อมูลก่อนเติมทะเบียนส่วนตัว</p>
      <p v-if="target==='contracts'||target==='invoices'" class="text-sm text-slate-600">สัญญาจะรอแนบเอกสารและลงนาม ส่วนบิลจะเริ่มเป็นฉบับร่าง</p>
      <Button :disabled="busy" @click="checkMapping">ตรวจรายการก่อนสร้าง</Button>
      <div v-if="mappingPreview" class="border rounded-lg p-4 space-y-2"><p>สร้างใหม่ <strong>{{ mappingPreview.created }}</strong> · ข้ามรายการเดิม <strong>{{ mappingPreview.skipped }}</strong> · ผิดพลาด <strong>{{ mappingPreview.error_count }}</strong></p><div v-if="mappingPreview.errors.length" class="max-h-48 overflow-auto text-sm text-red-700"><p v-for="item in mappingPreview.errors" :key="item.row">แถว {{ item.row }}: {{ item.message }}</p></div><Button v-if="mappingPreview.created&&mappingPreview.error_count===0" :disabled="busy" @click="applyMapping">ยืนยันสร้างรายการจริง</Button></div>
    </CardContent></Card>
  </div>
</template>
