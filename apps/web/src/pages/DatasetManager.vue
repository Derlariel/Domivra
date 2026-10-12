<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { get, post, api, fileData, message } from '@/lib/api'

type Sheet={name:string;headers:string[];rows:string[][]}
type Parsed={filename:string;sheets:Sheet[]}
type Dataset={id:string;name:string;filename:string;row_count:number;created_at:string}
type Detail=Dataset&{headers:string[];rows:{row_number:number;values:string[]}[]}
const client=useQueryClient(),file=ref<File|null>(null),preview=ref<Parsed|null>(null),selected=ref(''),offset=ref(0),busy=ref(false),error=ref(''),notice=ref('')
const {data:datasets}=useQuery({queryKey:['datasets'],queryFn:()=>get<Dataset[]>('/datasets')})
const {data:detail,isFetching}=useQuery({queryKey:computed(()=>['dataset',selected.value,offset.value]),queryFn:()=>get<Detail>(`/datasets/${selected.value}?offset=${offset.value}`),enabled:computed(()=>!!selected.value)})
async function parse(){if(!file.value)return;try{busy.value=true;error.value='';notice.value='';preview.value=await post<Parsed>('/datasets/parse',{filename:file.value.name,file:await fileData(file.value)})}catch(e){error.value=message(e)}finally{busy.value=false}}
async function confirm(){if(!preview.value)return;try{busy.value=true;error.value='';const result=await post<{ids:string[];datasets:number;rows:number}>('/datasets/confirm',preview.value);preview.value=null;file.value=null;notice.value=`นำเข้า ${result.datasets} ตาราง รวม ${result.rows} แถวแล้ว`;await client.invalidateQueries({queryKey:['datasets']});selected.value=result.ids[0]||'';offset.value=0}catch(e){error.value=message(e)}finally{busy.value=false}}
function open(id:string){selected.value=id;offset.value=0;error.value=''}
async function remove(item:Dataset){if(!window.confirm(`ลบชุดข้อมูล “${item.name}” และทุกแถวอย่างถาวร?`))return;try{error.value='';await api.delete(`/datasets/${item.id}`);if(selected.value===item.id)selected.value='';notice.value='ลบชุดข้อมูลแล้ว';await client.invalidateQueries({queryKey:['datasets']})}catch(e){error.value=message(e)}}
</script>

<template>
  <div class="space-y-5">
    <Card><CardHeader><CardTitle>นำเข้าข้อมูลของหอพัก</CardTitle></CardHeader><CardContent class="space-y-3">
      <p class="text-slate-600">ใช้ไฟล์ CSV หรือ Excel หัวตารางและคอลัมน์จะแสดงตามไฟล์ของคุณ แต่ละแผ่นงานใน Excel จะเป็นหนึ่งตาราง</p>
      <p class="text-sm text-slate-500">ไม่เกิน 4 MB, 20 แผ่นงาน, 200 คอลัมน์ และ 5,000 แถวต่อไฟล์ ข้อมูลชุดนี้ใช้ดูและจัดเก็บตามต้นฉบับ ยังไม่เปลี่ยนบิล สัญญา หรือบัญชีผู้พักโดยอัตโนมัติ</p>
      <p class="text-sm text-amber-700">ชุดข้อมูลนำเข้าจะเก็บจนกว่าจะลบทั้งชุด หากมีข้อมูลส่วนตัว ให้ตรวจวัตถุประสงค์และลบเมื่อหมดความจำเป็น</p>
      <div class="flex flex-wrap items-center gap-3"><input type="file" accept=".csv,.xlsx" aria-label="เลือกไฟล์ข้อมูล" @change="file=($event.target as HTMLInputElement).files?.[0]||null;preview=null" /><Button :disabled="!file||busy" @click="parse">ดูตัวอย่างก่อนนำเข้า</Button></div>
    </CardContent></Card>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p><p v-if="notice" class="p-3 rounded-lg bg-emerald-50 text-emerald-800">{{ notice }}</p>
    <Card v-if="preview"><CardHeader><CardTitle>ตรวจข้อมูลจาก {{ preview.filename }}</CardTitle></CardHeader><CardContent class="space-y-4">
      <div v-for="sheet in preview.sheets" :key="sheet.name" class="border rounded-lg p-3"><strong>{{ sheet.name }}</strong><p class="text-sm text-slate-600">{{ sheet.rows.length }} แถว · {{ sheet.headers.length }} คอลัมน์</p><div class="overflow-x-auto mt-2"><table class="text-sm min-w-full"><thead><tr><th v-for="header in sheet.headers" :key="header" class="border px-3 py-2 text-left whitespace-nowrap">{{ header }}</th></tr></thead><tbody><tr v-for="(row,index) in sheet.rows.slice(0,3)" :key="index"><td v-for="(cell,i) in row" :key="i" class="border px-3 py-2 whitespace-nowrap">{{ cell||'—' }}</td></tr></tbody></table></div></div>
      <Button :disabled="busy" @click="confirm">ยืนยันนำเข้าทุกตาราง</Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>ชุดข้อมูลที่นำเข้าแล้ว</CardTitle></CardHeader><CardContent><div v-if="!datasets?.length" class="text-slate-500">ยังไม่มีชุดข้อมูล</div><div v-for="item in datasets||[]" :key="item.id" class="border-b py-3 flex flex-wrap items-center justify-between gap-3"><button class="text-left brand font-semibold" @click="open(item.id)">{{ item.name }} <span class="text-slate-500 font-normal">· {{ item.row_count }} แถว · {{ item.filename }}</span></button><Button size="sm" variant="outline" @click="remove(item)">ลบชุดข้อมูล</Button></div></CardContent></Card>
    <Card v-if="selected"><CardHeader><CardTitle>{{ detail?.name||'กำลังโหลด…' }}</CardTitle></CardHeader><CardContent><p v-if="isFetching" class="text-slate-500">กำลังโหลดข้อมูล…</p><div v-if="detail" class="overflow-x-auto"><table class="text-sm min-w-full"><thead><tr><th class="border px-3 py-2 text-left">แถว</th><th v-for="(header,i) in detail.headers" :key="i" class="border px-3 py-2 text-left whitespace-nowrap">{{ header }}</th></tr></thead><tbody><tr v-for="row in detail.rows" :key="row.row_number"><td class="border px-3 py-2">{{ row.row_number }}</td><td v-for="(cell,i) in row.values" :key="i" class="border px-3 py-2 whitespace-nowrap">{{ cell||'—' }}</td></tr></tbody></table></div><div v-if="detail" class="flex items-center gap-3 mt-4"><Button variant="outline" :disabled="offset===0" @click="offset=Math.max(0,offset-100)">ก่อนหน้า</Button><span>{{ offset+1 }}–{{ Math.min(offset+100,detail.row_count) }} จาก {{ detail.row_count }}</span><Button variant="outline" :disabled="offset+100>=detail.row_count" @click="offset+=100">ถัดไป</Button></div></CardContent></Card>
  </div>
</template>
