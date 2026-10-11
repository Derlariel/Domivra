import axios from 'axios'
export const api = axios.create({ baseURL: '/api', withCredentials: true, timeout: 20000 })
export type Role = 'platform' | 'admin' | 'resident'
export type User = { id: string; username: string; name: string; role: Role; unit_id: string | null; organization: string }
export type Row = Record<string, unknown> & { id: string }
export const get = async <T>(path: string): Promise<T> => (await api.get<T>(path)).data
export const post = async <T>(path: string, data: unknown): Promise<T> => (await api.post<T>(path, data)).data
export const patch = async <T>(path: string, data: unknown): Promise<T> => (await api.patch<T>(path, data)).data
export const message = (error: unknown): string => axios.isAxiosError(error) ? String(error.response?.data?.error || error.message) : error instanceof Error ? error.message : 'เกิดข้อผิดพลาด'
export const currency = (value: unknown): string => `฿${Number(value || 0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}`
export const date = (value: unknown): string => value ? new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'numeric'}).format(new Date(String(value))) : '—'
export const statusName = (value: unknown): string => ({active:'ใช้งาน',suspended:'พักการใช้งาน',available:'ว่าง',occupied:'มีผู้พัก',maintenance:'ปิดปรับปรุง',open:'รอดำเนินการ',in_progress:'กำลังดำเนินการ',done:'เสร็จแล้ว',draft:'ฉบับร่าง',published:'รอชำระ',paid:'ชำระแล้ว',pending:'รอตรวจ',verified:'ยืนยันแล้ว',rejected:'ปฏิเสธ',requested:'คำขอใหม่',reviewed:'ตรวจแล้ว',inspection:'นัดตรวจ',settlement:'ปิดยอด',completed:'เสร็จสิ้น',signed:'ลงนามแล้ว'} as Record<string,string>)[String(value)] || String(value ?? '—')
export const fileData = (file: File): Promise<string> => new Promise((resolve,reject)=>{if(file.size>4_000_000)return reject(new Error('ไฟล์ต้องไม่เกิน 4 MB'));const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('อ่านไฟล์ไม่ได้'));reader.readAsDataURL(file)})
