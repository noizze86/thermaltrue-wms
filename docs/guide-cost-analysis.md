# Panduan Halaman Cost Analysis — Thermaltrue WMS v1.0.4

Lokasi menu: **Analysis → Cost Analysis** (rute `/analysis/cost`). Halaman ini mengukur **biaya yang menempel pada persediaan** — dari harga beli, biaya simpan (carrying cost), biaya melayani pesanan (cost-to-serve), sampai kerugian akibat proses yang lambat (efficiency penalty). Sumber data: endpoint `/api/cost/summary`, `/api/cost/carrying-cost`, `/api/cost/cost-to-serve`, `/api/cost/efficiency-penalty`, `/api/budgets` (backend `handlers/cost_analysis.rs` + `advanced.rs`), disimpan ke tabel `cost_metrics` (bulanan) dan `cost_per_order`.

---

## 1. Fungsi & Kegunaan Umum

1. **Melihat total nilai & risiko biaya persediaan** — berapa rupiah tertanam di stok, berapa biaya tahunan untuk menyimpannya.
2. **Memantau tren harga beli per material** — termasuk persentase kenaikan/penurunan antar pembelian.
3. **Membandingkan harga antar supplier** untuk satu material — dasar negosiasi atau penetapan supplier terbaik.
4. **Mengontrol anggaran pembelian per kategori** (Budget vs Actual) per bulan.
5. **Menghitung biaya sejati per material** (true unit cost): harga beli + biaya simpan + susut + alokasi sewa gudang.
6. **Menilai profitabilitas tiap transaksi** (cost-to-serve) — transaksi mana OK dan mana LOSS setelah biaya picking/packing/admin.
7. **Mengukur penalti efisiensi** — rupiah yang hilang karena transaksi lebih lama dari waktu standar.

---

## 2. Isi Halaman Per Bagian

### 2.1. Tiga Kartu Ringkasan (atas)

| Kartu | Makna | Perhitungan |
|-------|-------|-------------|
| **Total Inventory Value** | Total nilai persediaan sesuai filter + jumlah material | `Σ (stok × aktivitas keluar terakhir)` |
| **Total Quantity** | Total unit seluruh material | `Σ stok` |
| **Avg Value per Material** | Rata-rata nilai per material | `total value ÷ jumlah material` |

### 2.2. Empat Kartu Cost Summary

| Kartu | Isi |
|-------|-----|
| **Carrying Cost Rate** | Persentase biaya tahunan dari nilai stok (default **20%**, dari `company_profile`) + indikator tren (▲/▼/→) |
| **Est. Annual Carrying Cost** | `Total nilai stok × rate` — estimasi rupiah yang terpakai menahan stok dalam setahun |
| **Avg Purchase Price (90d)** | Rata-rata harga pembelian dari transaksi `in` dalam 90 hari terakhir |
| **Transactions (30d)** | Jumlah transaksi non-void dalam 30 hari terakhir |

### 2.3. "Material Cost Trend" — analisis per material

Dropdown pilih material → dari transaksi `in` material tersebut:

- **Grafik garis Purchase Price**: pergerakan harga beli tiap pembelian
- **Tabel** tanggal / harga / **Variance %**: selisih harga vs pembelian sebelumnya (+ = naik merah, − = turun hijau)

Kegunaan: deteksi inflasi harga bahan, supplier yang menaikkan harga, bahan yang harganya fluktuatif.

### 2.4. "Supplier Price Comparison" (muncul setelah pilih material)

Bar chart harga **terakhir** per supplier untuk material yang dipilih (dari tabel supplier prices). Kegunaan: bandingkan langsung siapa supplier termurah saat ini.

### 2.5. "Budget vs Actual" (muncul setelah pilih material)

Form pengelolaan **anggaran belanja per kategori per bulan**:

1. Pilih **Category** + **Period** (bulan) + nominal **Budget (IDR)**
2. Klik **Save Budget** (menyimpan ke database — badge menjadi `Persisted`) atau **Delete**
3. Kartu **Budget** (hijau) vs **Actual** (biru) = nilai stok kategori itu saat ini
4. Muncul grafik **Budget vs Actual Comparison** untuk semua budget yang tersimpan (maks. 12)

Kegunaan: kontrol belanja persediaan agar tidak melampaui anggaran.

### 2.6. "Carrying Cost & True Unit Cost" (Fase 6)

Tabel 20 material bernilai terbesar, kolom:

| Kolom | Rumus |
|-------|-------|
| Value | `stok × harga` |
| **Carrying** | `nilai × rate carry` (default 20%) — biaya modal terikat |
| **Shrinkage** | `selisih opname (difference) × harga` — kerugian selisih stock |
| **Storage** | alokasi proporsional dari sewa gudang bulanan (default Rp 500.000) |
| **True Unit Cost** | `harga + carrying + shrinkage + storage` per unit yang benar-benar keluar |

Kegunaan: mengganti "harga beli" dengan **biaya sejati** per unit — dasar penetapan harga jual & keputusan simpan vs cairkan.

### 2.7. "Cost-to-Serve (90 days)" — profitabilitas per transaksi

Analisis maks. 100 transaksi `approved` dalam 90 hari terakhir:

- **Picking** = menit proses × (upah/jam ÷ 60) × qty — **Packing** = 30% × picking — **Admin** = Rp 2.000 tetap
- **Total Cost** = ketiga komponen tadi; **Margin** = `(qty × harga) − total cost`
- Badge **OK** (hijau) / **LOSS** (merah)
- Header: jumlah dianalisis, profitable, unprofitable, **profitability rate**

Kegunaan: menemukan transaksi yang biayanya melebihi nilai jual (rugi), lalu diperbaiki lewat strategi harga/volume/proses.

### 2.8. "Efficiency Penalty (30 days)"

Per jenis transaksi (in/out/transfer/adjustment), rata-rata durasi aktual vs **standar backend** (in: 10 mnt, out: 15, transfer: 20, adjustment: 5):

- **Variance menit** → `variance × (upah/jam ÷ 60) × jumlah transaksi` = penalti per jenis
- Kotak merah: **total Efficiency Penalty 30 hari** dalam Rupiah (@ rate upah)

Kegunaan: kuantifikasi rupiah yang hilang akibat proses kerja lebih lambat dari standar — dasar evaluasi SOP dan kebutuhan staf.

### 2.9. Grafik "Top 10 by Value" & "Value by Category"

- **Bar chart**: 10 material dengan nilai tertinggi
- **Pie chart**: distribusi nilai stok **per kategori**

Kegunaan: mengetahui di mana uang terpusat dan kategori mana yang paling menguras anggaran.

### 2.10. Tabel "Cost Details"

Daftar semua material (urut berdasar `stok × turnover`), kolom: Material, SKU, Stock Qty, **Turnover**, **Stock Value** + kotak pencarian + **Export XLSX** (4 sheet: Cost Details, Cost Trend, Carrying Cost, Cost-to-Serve).

---

## 3. Cara Memakai Halaman (Workflow Praktis)

1. **Pertama kali**: cek **Settings → Company Profile** untuk nilai dasar: `carrying_cost_rate` (default 20%), `storage_cost_monthly` (default 500.000), `hourly_labor_rate` (default 5.000) — semua perhitungan halaman ini memakai nilai tersebut.
2. **Pantau kartu atas & Cost Summary**: di mana nilai terbesar? Apakah estimasi biaya simpan tahunan signifikan?
3. **Pilih material di dropdown** → analisis tren harga & perbandingan supplier.
4. **Simpan budget per kategori** di bagian Budget vs Actual, lalu bandingkan dengan Actual.
5. **Tinjau Cost-to-Serve**: transaksi LOSS → penyebab: qty kecil, margin tipis, proses lambat.
6. **Tinjau Efficiency Penalty**: jenis transaksi berpenalti besar berarti SOP perlu dirapikan.
7. **Export XLSX** (4 sheet) untuk rekap laporan biaya bulanan.

---

## 4. Cara Analisis Per Material (Step by Step)

1. **Pilih material** di seksi **Material Cost Trend** (dropdown) atau cari di tabel Cost Details.
2. **Baca tren harga beli**: kenaikan konsisten → renegosiasi; harga melonjak sekali → antisipasi inflasi.
3. **Bandingkan supplier** di chart: pilih supplier termurah dengan kualitas setara; hitung selisih rupiah per unit × volume = potensi penghematan.
4. **Lihat True Unit Cost**: jika tinggi, artinya menyimpan saldo material itu mahal — kurangi buffer, atau perbaiki akurasi opname untuk menekan shrinkage.
5. **Cek profitabilitas di Cost-to-Serve**: margin negatif konsisten → renegosiasi harga jual, konsolidasi pemesanan, atau evaluasi kelayakan layanan order kecil.
6. **Catat hasil** → aksi: ubah supplier, restrukturisasi SOP, atau request budget tambahan → dokumentasikan dengan Export XLSX.

---

## 5. Catatan Teknis

- Akses: permission `view_dashboard`, cakupan mengikuti gudang user (warehouse-scoped).
- Perhitungan **disimpan ke `cost_metrics` (bulanan per material + `__summary__`)** dan `cost_per_order` saat halaman dibuka — riwayat tersedia untuk trend lintas waktu.
- Harga yang dipakai: `materials.price`, `transactions.price` (jenis `in`, status `approved`), dan `supplier_prices`.
- Nilai **turnover** di Cost Details/grafik nilai berasal dari `getAnalysisAll` (aktivitas keluar terakhir), bukan ITR seperti di Material Analysis.

---

_© 2026 Thermaltrue — update terakhir: v1.0.4._