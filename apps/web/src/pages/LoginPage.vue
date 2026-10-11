<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { Building2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import FormDialog, { type Field } from '@/components/FormDialog.vue'
import { useAuth } from '@/stores/auth'
import { message, post } from '@/lib/api'
const router=useRouter(),auth=useAuth(),error=ref(''),registerOpen=ref(false)
const {defineField,handleSubmit,errors,isSubmitting}=useForm({validationSchema:toTypedSchema(z.object({organization:z.string().min(3,'ระบุรหัสองค์กร'),username:z.string().min(1,'ระบุชื่อผู้ใช้'),password:z.string().min(1,'ระบุรหัสผ่าน')})),initialValues:{organization:'',username:'',password:''}})
const [organization,organizationAttrs]=defineField('organization'),[username,usernameAttrs]=defineField('username'),[password,passwordAttrs]=defineField('password')
const submit=handleSubmit(async values=>{try{error.value='';await auth.login(values.organization,values.username,values.password);await router.replace(auth.user?.role==='platform'?'/platform':auth.user?.role==='admin'?'/owner/overview':'/app/home')}catch(e){error.value=message(e)}})
const registrationFields:Field[]=[{name:'organization',label:'รหัสองค์กร',value:'domivra'},{name:'building',label:'อาคาร'},{name:'number',label:'เลขห้อง'},{name:'invite',label:'รหัสเชิญจากนิติบุคคล'},{name:'name',label:'ชื่อผู้พัก'},{name:'username',label:'ชื่อผู้ใช้'},{name:'password',label:'ตั้งรหัสผ่านอย่างน้อย 12 ตัวอักษร',type:'password'}]
async function register(values:Record<string,unknown>){z.object({organization:z.string().min(3),building:z.string().min(1),number:z.string().min(1),invite:z.string().min(10),name:z.string().min(1),username:z.string().min(1),password:z.string().min(12)}).parse(values);await post('/register',values);await auth.login(String(values.organization),String(values.username),String(values.password));await router.replace('/app/home')}
</script>
<template><main class="min-h-screen flex items-center justify-center p-5"><section class="w-full max-w-[410px] bg-white border rounded-2xl p-8 shadow-sm">
  <div class="flex items-center gap-3 mb-8 text-xl font-bold"><span class="brand-bg rounded-xl text-white p-2"><Building2 :size="24" /></span>domivra</div>
  <h1 class="text-3xl font-bold">เข้าสู่ระบบ</h1><p class="text-slate-500 mb-7">แอดมิน Domivra ใช้รหัสองค์กร platform · เจ้าของหอพักและผู้พักใช้รหัสองค์กรของหอพัก</p>
  <form class="space-y-5" @submit.prevent="submit">
    <div><Label for="organization" class="field-label">รหัสองค์กร</Label><Input id="organization" v-model="organization" v-bind="organizationAttrs" autocomplete="organization" /><p class="error-text">{{ errors.organization }}</p></div>
    <div><Label for="username" class="field-label">ชื่อผู้ใช้</Label><Input id="username" v-model="username" v-bind="usernameAttrs" autocomplete="username" /><p class="error-text">{{ errors.username }}</p></div>
    <div><Label for="password" class="field-label">รหัสผ่าน</Label><Input id="password" v-model="password" v-bind="passwordAttrs" type="password" autocomplete="current-password" /><p class="error-text">{{ errors.password }}</p></div>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p><Button type="submit" class="brand-bg text-white w-full h-11" :disabled="isSubmitting">เข้าสู่ระบบ</Button>
  </form><button class="brand mt-6 text-sm font-semibold" @click="registerOpen=true">ลงทะเบียนด้วยรหัสเชิญห้องพัก</button>
  <p class="text-xs text-slate-500 mt-6">บัญชีเจ้าของหอพักดูแลลูกบ้านขององค์กรตนเองเท่านั้น</p>
</section><FormDialog v-if="registerOpen" title="ลงทะเบียนห้องพัก" :fields="registrationFields" :save="register" submit-label="ลงทะเบียน" @close="registerOpen=false" /></main></template>
