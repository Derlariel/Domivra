# Domivra

เว็บจัดการหอพักและคอนโดตามแบบ Figma มี 3 ส่วน: หลังบ้านแพลตฟอร์ม, หลังบ้านของลูกค้าแต่ละองค์กร และเว็บแอปผู้พักที่ใช้บนมือถือได้

## เริ่มใช้งาน

ต้องมี Node.js 22 ขึ้นไปและ Docker Desktop ที่เปิดอยู่

```bash
cd domivra
npm ci
npm run setup
docker compose up --build -d
```

เปิด [Domivra](http://127.0.0.1:5173/login) ข้อมูลเข้าระบบครั้งแรกของผู้ดูแลแพลตฟอร์มอยู่ใน container:

```bash
docker compose exec -T api cat /app/runtime/platform-credentials.txt
```

ใช้รหัสองค์กร `platform` สำหรับบัญชีนี้ จากหน้าแพลตฟอร์มสร้างองค์กรลูกค้าและบัญชีผู้ดูแลได้ แต่ละองค์กรมีข้อมูลแยกด้วย `org_id` และ API ตรวจสิทธิ์ตามบทบาททุกคำขอ

การติดตั้งบนเครื่องผู้พัฒนาเดิมย้ายข้อมูลตัวอย่างเข้าองค์กร `domivra` แล้ว บัญชี `admin` และ `resident` ใช้รหัสเดิมที่เก็บใน `data/initial-credentials.txt` ส่วนการ clone ใหม่จะเริ่มด้วยฐานข้อมูลว่างและบัญชีแพลตฟอร์มหนึ่งบัญชี ห้ามส่งไฟล์รหัสผ่านหรือ `.env` ให้ผู้อื่น

## สแตกที่ใช้

| ส่วน | เทคโนโลยี |
|---|---|
| เว็บ | Vue 3 Composition API, TypeScript strict, Vite, Tailwind CSS, shadcn-vue, Pinia, Vue Router, TanStack Query for Vue, Axios, VeeValidate + Zod, Lucide |
| API | Node.js, Fastify, TypeScript |
| ข้อมูล | PostgreSQL, UUID, `numeric(12,2)` สำหรับจำนวนเงิน |
| เอกสาร | SeaweedFS S3 API แบบส่วนตัว, SSE-S3 AES256, กุญแจเก็บใน `.env` |
| AI | Python FastAPI, ผลลัพธ์ JSON แบบมี schema, ตรวจความผิดปกติด้วยกฎก่อนเรียก LLM adapter |
| พัฒนา/CI | Docker Compose, Vitest, Testcontainers, Playwright, GitHub Actions |

ไม่มี Java และ JUnit 5 เพราะ backend ที่เลือกเป็น Node.js

## การใช้งานหลัก

- **แพลตฟอร์ม:** สร้างองค์กรลูกค้าและพัก/เปิดการใช้งาน
- **ผู้ดูแลลูกค้า:** โครงการ ห้อง ผู้พัก สัญญา บิล ตรวจหลักฐานชำระ แจ้งซ่อม รายงานปัญหาส่วนกลาง ประกาศ กฎ ย้ายออก รายงาน และตั้งค่าเบอร์นิติบุคคล/รปภ./ฉุกเฉิน
- **ผู้พัก:** ดูบิล ส่งหลักฐาน แจ้งซ่อม แจ้งพื้นที่ส่วนกลางชำรุดแบบอัปเดตทันที ติดต่อฉุกเฉิน อ่านประกาศ/กฎ ดูสัญญา ลงนามอิเล็กทรอนิกส์ และขอย้ายออก
- **สัญญา:** เอกสารตัวจริงใช้ PDF สแกนและการยืนยันรับฉบับจริง; แบบอิเล็กทรอนิกส์ยืนยันชื่อ รหัสผ่าน และความยินยอม พร้อมเวลาและ SHA-256 ของ PDF ที่ลงนาม
- **นำเข้าห้อง:** `.csv` หรือ `.xlsx` แผ่นแรกไม่เกิน 4 MB / 5,000 แถว หัวตารางต้องมี `property,building,number,floor,rent,deposit,area` และเพิ่ม `room_type,water_meter,electric_meter` ได้ ข้อมูลห้องซ้ำถูกข้าม

การตรวจรับชำระเป็นการบันทึกผลที่ผู้ดูแลตรวจจากบัญชีธนาคารจริง ระบบไม่โอนเงินเอง การลงนามอิเล็กทรอนิกส์นี้บันทึกหลักฐานการยืนยันในระบบ แต่ยังไม่ใช่ลายมือชื่อดิจิทัลจากผู้ให้บริการรับรอง

## คำสั่งที่ใช้บ่อย

```bash
npm run build
npm test
npm run test:integration
npm run test:e2e
docker compose ps
docker compose logs -f api
docker compose down
```

`test:integration` ใช้ Testcontainers จึงต้องเปิด Docker ส่วน `test:e2e` ต้องมี browser ของ Playwright (`npx playwright install chromium`) GitHub Actions ติดตั้ง browser และรันทุกชุดอัตโนมัติ

## การตั้งค่าและข้อมูลเดิม

`npm run setup` สร้างรหัสสุ่มใน `.env` และไฟล์ `runtime/s3.json` แบบไม่แสดงค่าบนหน้าจอ กุญแจ `S3_SSE_KEK` ต้องสำรองพร้อม volume `storage_data`; หากกุญแจหาย จะอ่านเอกสารที่เข้ารหัสไว้ไม่ได้ ห้ามเรียก `docker compose down -v` เมื่อยังต้องใช้ข้อมูล

ข้อมูล SQLite เดิมยังอยู่ใน `data/` และไม่ได้ลบ สคริปต์ `npm run migrate:legacy` นำเข้าข้อมูลหลักจากฐานเดิมได้ครั้งเดียว แต่ไม่ย้ายไฟล์หลักฐาน/สัญญาจากระบบเดิม; ในข้อมูลตัวอย่างนี้มีหลักฐานชำระ 1 รายการที่ไม่มีไฟล์ต้นฉบับ จึงไม่ได้นำรายการนั้นเข้าฐานใหม่ ควรเก็บ `data/` เป็นสำเนาอ้างอิง

สำหรับใช้งานนอกเครื่องพัฒนา ให้เตรียม HTTPS, การสำรอง PostgreSQL และ S3, การจัดการกุญแจ และนโยบายยืนยันตัวตน/การลงนามที่เหมาะกับการใช้งานจริง

โค้ดเก่า `server.js` และ `public/` ยังคงอยู่เพื่ออ้างอิง ขณะนี้ `docker compose` เปิดเฉพาะเว็บ Vue และ API PostgreSQL
