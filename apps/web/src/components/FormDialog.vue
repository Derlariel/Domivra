<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { message } from '@/lib/api'
export type Field = { name:string; label:string; type?:'text'|'number'|'date'|'month'|'datetime-local'|'password'|'tel'|'email'|'file'|'textarea'|'select'|'checkbox'; required?:boolean; options?:{value:string;label:string}[]; value?:string }
const props=defineProps<{ title:string; fields:Field[]; save:(values:Record<string,unknown>)=>Promise<void>; submitLabel?:string; note?:string }>()
const emit=defineEmits<{ close:[] }>()
const values=reactive<Record<string,unknown>>(Object.fromEntries(props.fields.map(f=>[f.name,f.value??(f.type==='checkbox'?false:'')])))
const busy=ref(false),error=ref('')
async function submit(){busy.value=true;error.value='';try{await props.save({...values});emit('close')}catch(e){error.value=message(e)}finally{busy.value=false}}
</script>
<template>
  <div class="dialog-overlay" @click.self="emit('close')"><section class="dialog-panel" role="dialog" aria-modal="true" :aria-label="title">
    <h2 class="text-xl font-bold mb-2">{{ title }}</h2><p v-if="note" class="text-sm text-slate-500 mb-4">{{ note }}</p>
    <form class="space-y-4" @submit.prevent="submit">
      <div v-for="field in fields" :key="field.name">
        <Label :for="`form-${field.name}`" class="field-label">{{ field.label }}</Label>
        <Textarea v-if="field.type==='textarea'" :id="`form-${field.name}`" :model-value="String(values[field.name]??'')" :required="field.required!==false" @update:model-value="values[field.name]=$event" />
        <select v-else-if="field.type==='select'" :id="`form-${field.name}`" v-model="values[field.name]" class="w-full border rounded-md h-10 px-3 bg-white" required><option value="" disabled>เลือกข้อมูล</option><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
        <input v-else-if="field.type==='checkbox'" :id="`form-${field.name}`" v-model="values[field.name]" type="checkbox" :required="field.required!==false" class="h-4 w-4" />
        <Input v-else-if="field.type==='file'" :id="`form-${field.name}`" type="file" :required="field.required!==false" @change="values[field.name]=($event.target as HTMLInputElement).files?.[0]" />
        <Input v-else :id="`form-${field.name}`" :type="field.type||'text'" :model-value="String(values[field.name]??'')" :required="field.required!==false" @update:model-value="values[field.name]=$event" />
      </div>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div class="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" @click="emit('close')">ยกเลิก</Button><Button type="submit" class="brand-bg text-white" :disabled="busy">{{ busy?'กำลังบันทึก…':submitLabel||'บันทึก' }}</Button></div>
    </form>
  </section></div>
</template>
