# Panduan Halaman Material Analysis — Thermaltrue WMS v1.0.4

Lokasi menu: **Analysis → Material Analysis** (rute `/analysis/material`). Halaman ini adalah pusat pemantauan kesehatan **setiap material** di gudang — gabungan data transaksi (in/out), harga, min/max stock, dan klasifikasi ABC dari halaman ABC Analysis. Data dihitung di backend (`backend/src/server/handlers/material_analysis.rs`, endpoint `/api/material-analysis/summary` dan `/api/material-analysis/details`), dan disimpan harian ke tabel `material_metrics` sebagai riwayat analisis.

---

## 1. Fungsi & Kegunaan Umum

1. **Menemukan material bermasalah**: dead stock (tidak laku), slow moving (jarang terpakai), expired (kadaluarsa), dan nilai rupiah yang tertanam di dalamnya.
2. **Menilai risiko stok habis** (stockout risk) per material, dengan prioritas otomatis untuk item berisiko tinggi.
3. **Melihat tren pergerakan per material**: net quantity harian, moving average 7 & 30 hari, dan tren harga beli — dasar untuk keputusan reorder.
4. **Membandingkan perputaran stok (ITR)** antar material — mana yang cepat habis, mana yang mengendap.
5. **Menggabungkan klasifikasi ABC/XYZ** (dari halaman ABC Analysis) ke dalam satu tabel.
6. **Export laporan ke Excel (XLSX)** dengan 2 sheet: semua material + material berisiko tinggi.

---

## 2. Isi Halaman Per Bagian

### 2.1. Enam Kartu Ringkasan (atas halaman)

| Kartu | Arti | Rumus / kriteria |
|-------|------|------------------|
| **Dead Stock** (merah) | Material yang tidak pernah keluar > 90 hari | `no transaksi out ≥ 90 hari`; tampil jumlah item + **total nilai rupiah** (stok × harga) |
| **Slow Moving** (kuning) | Material idle 30–90 hari | `out terakhir antara 30–90 hari`; jumlah item + total nilai rupiah |
| **Expired** (ungu) | Material sudah lewat tanggal kadaluarsa tapi belum habis | `expiry_date ≤ hari ini DAN quantity > 0`; jumlah item + nilai rupiah |
| **Total Materials** | Jumlah material aktif | `is_active = true` |
| **Avg Stockout Risk** | Rata-rata risiko stok habis seluruh material | rata-rata `stockout_risk` dari `material_metrics`; badge ⚠ High jika > 50% |
| **Avg Turnover (ITR)** | Rata-rata perputaran stok 12 bulan | `konsumsi 12 bulan ÷ stok`; `> 6` cepat, `< 1` lambat |

**Kegunaan**: sekali pandang tahu kondisi gudang — berapa banyak uang yang "mengendap" di stok mati, dan seberapa besar risiko kehabisan stok.

### 2.2. "⚠ High Stockout Risk Materials"

Daftar maksimal 10 material dengan `stockout_risk > 50%`, kolom: SKU, Nama, **Risk %** (merah jika > 80%), **Stock** (stok saat ini), **Min** (min stock), **Cover** (berapa hari lagi stok habis; ∞ jika tidak ada pemakaian).

**Kegunaan**: daftar "harus segera di-restock" — bahan yang paling mengancam operasional jika kosong.

### 2.3. Grafik "Transaction Trend" — analisis per material

Dropdown pilih material → grafik garis 4 seri:

- **Net Qty** (biru): per hari, `jumlah masuk (+) − jumlah keluar (−)`
- **MA-7** (oranye): rata-rata 7 hari terakhir → tren jangka pendek
- **MA-30** (merah): rata-rata 30 hari → tren jangka panjang
- **Purchase Price** (hijau): harga beli dari transaksi `in` + data harga supplier

**Kegunaan**: lihat pola permintaan (musiman / menurun / naik), prediksi kapan perlu reorder, dan pantau tren harga beli.

### 2.4. Grafik "Top 10 by ITR"

Bar chart 10 material dengan **Inventory Turnover Ratio tertinggi** (`konsumsi 12 bulan ÷ stok saat ini`).

**Kegunaan**: material yang paling cepat berputar = prioritas restock & barang yang paling sering diminta.

### 2.5. Tabel "All Material Analysis"

Tabel semua material aktif, dengan kontrol:

- **Filter pergerakan**: `All` / `Slow (<1/tahun)` / `Fast (>6/tahun)` — berdasarkan ITR
- **Sorting**: `Days Since Last Tx` (default) / `Turnover` / `Name`
- **Pencarian** (debounce 300 ms): cari nama material atau SKU
- **Export XLSX** (2 sheet: All Materials + High Risk)

Kolom tabel:

| Kolom | Makna |
|-------|-------|
| SKU / Name | Identitas material |
| Stock | Stok saat ini |
| Days Since Tx | Hari sejak transaksi terakhir; `Never` jika tidak pernah |
| ITR | `konsumsi 12 bulan ÷ stok` (2 desimal) |
| Risk | % risiko stok habis (hijau < 50, oranye 50–80, merah > 80) |
| ABC | Badge klasifikasi dari halaman ABC Analysis, mis. `A / XYZ` |
| Status | Badge `Active` / `Slow Moving` (> 30 hari) / `Dead Stock` (> 90 hari) |

---

## 3. Cara Memakai Halaman (Workflow Praktis)

1. **Buka halaman** → lihat 6 kartu ringkasan. Jika kartu merah/kuning/ungu besar → ada banyak uang mengendap atau risiko.
2. **Cek widget High Risk** → daftar yang harus segera di-handle (beli / pindahkan stok antar gudang).
3. **Gunakan filter & pencarian** untuk mempersempit daftar (misal filter `Fast` untuk bahan paling laku, atau `Slow` untuk kandidat pengurangan stok).
4. **Sort by Days Since Tx** → item teratas adalah kandidat dead stock.
5. **Export XLSX** untuk laporan ke atasan / rekap bulanan.

---

## 4. Cara Analisis Satu Material (Step by Step)

1. **Cari material** di tabel (ketik nama/SKU) atau lewat dropdown Transaction Trend.
2. **Baca kolom Status + Days Since Tx**: jika `Dead Stock`/`Slow Moving`, pertanyakan: apakah material masih dibutuhkan? Kalau tidak → pertimbangkan pengurangan stok/penghapusan; kalau ya → kenapa tidak terpakai?
3. **Baca kolom Risk**: jika > 80% — stok mendekati atau di bawah stok minimum → **segera buat purchase order**. Aturan backend: stok 0 → risk 100%; stok ≤ min → 80%; stok ≤ 1.5×min → 50%.
4. **Baca kolom ITR**: rendah (< 1) = stok menumpuk (beli berlebihan); tinggi (> 6) = stok cepat habis (harus sering restock). Idealnya ITR sedang sehingga stok tidak menumpuk tapi tidak pernah kosong.
5. **Lihat grafik Transaction Trend** untuk material tsb:
   - Net Qty menurun + MA-30 di bawah MA-7 → permintaan melandai.
   - Net Qty naik konsisten → amankan stok lebih.
   - **Purchase Price** naik → renegosiasi harga supplier / cari supplier lain.
6. **Bandingkan dengan Min/Max stock & Days Cover** (di export / High Risk): jika cover < lead time pengiriman supplier → risiko kosong.
7. **Lihat badge ABC**: material kelas A (nilai/konsumsi tertinggi) harus mendapat perhatian paling besar — salah kelola di kelas A dampaknya paling mahal.
8. **Catat temuan** → aksi: reorder, kurangi pembelian, disbursement/likuidasi stok mati, atau evaluasi supplier. Export XLSX untuk dokumentasi.

---

## 5. Catatan Teknis (sumber data & pembaruan)

- Setiap kali halaman dibuka, backend **menghitung ulang & menyimpan metrik harian** ke tabel `material_metrics` (period `daily`, upsert per material + gudang): `stockout_risk`, `days_cover`, `turnover_ratio`, konsumsi 3/6/12 bulan, inbound/outbound 30 hari, nilai inventori, status dead/slow, dan tren risiko (▲/▼/→) vs kemarin & rata-rata 7 hari.
- `abc_class`/`xyz_class` diambil dari `abc_classification` untuk hari ini — jadi **jalankan ABC Analysis dulu** (menu Analysis → ABC) agar kolom ABC terisi.
- Akses dibatasi: perlu permission `view_dashboard`, dan otomatis dibatasi sesuai scope gudang user (warehouse-scoped).

---

## 6. Lihat Juga

- `docs/guide-consumption-analysis.md` — analisis konsumsi material (seasonal index, safety stock, ROP)
- `docs/guide-instalasi-server.md` — instalasi & konfigurasi server

---

_© 2026 Thermaltrue — update terakhir: v1.0.4._