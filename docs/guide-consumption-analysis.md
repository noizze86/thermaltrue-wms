# Panduan Halaman Consumption Analysis — Thermaltrue WMS v1.0.4

Lokasi menu: **Analysis → Consumption Analysis** (rute `/analysis/consumption`). Data dihitung di backend (`backend/src/server/handlers/consumption.rs`, endpoint `/api/consumption-analysis/summary`, `/details`, `/seasonal`) dari **transaksi keluar (type='out')** lalu disimpan harian ke tabel `consumption_metrics`.

---

## 1. Fungsi & Kegunaan Umum

1. **Mengukur pemakaian material** (konsumsi = total barang keluar) dalam 3, 6, dan 12 bulan — dasar keputusan pembelian.
2. **Menentukan Safety Stock (stok pengaman)** per material agar tidak kehabisan saat permintaan fluktuatif: `SS = Z × σ × √LT`.
3. **Menghitung Reorder Point (ROP)** — level stok yang memicu pemesanan ulang: `ROP = (pemakaian harian × lead time) + safety stock`.
4. **Mendeteksi musim permintaan (seasonality)** per bulan — kapan stok harus dinaikkan/diturunkan.
5. **Memantau tren konsumsi per material** (▲ naik / ▼ turun) untuk antisipasi overstock/stockout.
6. **Export Excel** 3 sheet: Seasonal Index, Safety Stock, Consumption Details.

---

## 2. Isi Halaman Per Bagian

### 2.1. Empat Kartu Ringkasan (atas)

| Kartu | Arti |
|-------|------|
| **3-Month Usage** | Total barang keluar 90 hari terakhir |
| **6-Month Usage** | Total barang keluar 180 hari terakhir |
| **12-Month Usage** | Total barang keluar 365 hari terakhir |
| **Avg Lead Time** | Rata-rata jumlah **hari unik** terjadinya pemakaian per material (hari di mana ada transaksi keluar) |

**Kegunaan**: bandingkan 3 vs 6 vs 12 bulan → total pemakaian naik atau turun; lead time memberi gambaran seberapa sering material dipakai.

### 2.2. Grafik "Seasonal Consumption Pattern"

Bar chart 12 bulan (bergulir dari bulan saat ini): **Seasonal Index** per bulan = `total keluar bulan itu ÷ rata-rata 12 bulan`.

- Index **> 1.1** → **High season** (permintaan puncak) — hijau
- Index **< 0.9** → **Low season** — merah
- Teks di bawahnya merangkum: *"High season: Jan, Feb"* dan *"Low season: ..."*

**Kegunaan**: tahu kapan permintaan puncak → persiapan stok jauh hari.

### 2.3. Tabel "Seasonal Index Table"

12 baris: **Month, Index, Season** (badge High/Normal/Low). Keterangan di bawah: `Index > 1.1 = High, Index < 0.9 = Low`.

### 2.4. Tabel "Safety Stock Recommendations" (20 teratas)

Kolom: **Material | σ | Lead Time | Base SS | S. Index | Rec. SS | ROP**

| Kolom | Makna |
|-------|-------|
| σ | Standar deviasi konsumsi bulanan (tingkat variabilitas permintaan) |
| Lead Time | Hari unik pemakaian material |
| Base SS | `Z × σ × √LT` (Z default 1.65 = service level 95%) |
| S. Index | Indeks musiman material (pengaruh musim pada pemakaiannya) |
| Rec. SS | Base SS × S. Index (dibulatkan) — safety stock yang disarankan |
| ROP | `(pemakaian 12 bulan ÷ 365) × lead time + safety stock` |

**Kegunaan**: nilai stok pengaman dan titik reorder siap pakai untuk tiap material, sudah menyesuaikan musim.

### 2.5. Kartu "Safety Stock Calculator" & "ROP Calculator"

- Kartu SS: `SS = Z × σ × √LT` + **Avg Safety Stock** seluruh material.
- Kartu ROP: `ROP = (avg_daily_usage × lead_time) + safety_stock` + **input Z value** (default 1.65) + **Avg ROP**.
- Ubah Z → perhitungan dihitung ulang **real-time** di frontend (fallback).

### 2.6. Tabel "Consumption Details"

Kontrol: **dropdown pilih gudang** (All Warehouses / per gudang), **pencarian nama atau SKU**, tombol **Export XLSX**.

Kolom:

| Kolom | Makna |
|-------|-------|
| Material / SKU | Identitas |
| Stock | Stok saat ini |
| **Trend** | ▲ hijau = konsumsi 3 bulan naik vs 6 bulan; ▼ merah = turun; → = stabil |
| Cons (3mo) | Total keluar 90 hari |
| Cons (6mo) | Total keluar 180 hari |
| Safety Stock | Stok aman yang disarankan |
| ROP | Titik reorder |

---

## 3. Cara Memakai Halaman (Workflow Praktis)

1. **Lihat 4 kartu total** → tren keseluruhan: 12 bulan > 6 > 3 berarti pemakaian naik (antisipasi pembelian); sebaliknya turun (hindari pembelian boros).
2. **Grafik seasonal** → tandai bulan High season; stok harus cukup sebelum bulan itu tiba. Bulan Low season → kurangi pembelian.
3. **Safety Stock Recommendations** → ambil nilai Rec. SS & ROP untuk disesuaikan ke setting min stock material di Master Data.
4. **Consumption Details** → cari material tertentu: bahan dengan Trend ▲ perlu pasokan rutin; dengan ▼ tinjau ulang target stok.
5. **Export XLSX** → laporan perencanaan pembelian.

---

## 4. Cara Analisa Konsumsi Per Material (Step by Step)

Prinsip: konsumsi material = **total quantity transaksi OUT** dalam jendela 30/90/180/365 hari. "Lead time" yang dipakai aplikasi = jumlah **hari unik** terjadinya pemakaian (interval siklus pemakaian).

1. **Pilih material** di tabel (search nama/SKU) atau pilih gudang di dropdown.
2. **Bandingkan 3 vs 6 bulan**: untuk melihat bulanan — `pemakaian bulanan ≍ cons3/3` lalu `(cons6 − cons3)/3` lalu `(cons12 − cons6)/6`.
3. **Baca Trend**: ▲ artinya 3 bulan terakhir lebih besar dari 6 bulan sebelumnya → permintaan meningkat → pesan lebih sering / naikkan min stock. ▼ sebaliknya → hindari stok menumpuk.
4. **Lihat σ (sigma)**: σ besar = variasi besar (kadang nol, kadang banyak), stok pengaman besar. σ kecil = stabil → stok bisa tipis.
5. **Lihat Seasonal Index material**: > 1.1 = bulan permintaan tinggi → stok ekstra; < 0.9 = bulan sepi → tunda reorder.
6. **Safety Stock**: `SS = Z × σ × √LT`, lalu sesuaikan dengan musim → **Rec. SS**.
7. **ROP**: `(konsumsi 12 bulan ÷ 365) × lead time + SS`. Jika **stok ≤ ROP → saatnya membuat PO**. Bandingkan dengan kolom Stock untuk menilai urgensi.
8. **Padukan dengan ROP otomatis**: gunakan nilai ROP untuk pengaturan reorder material tsb; cek konsisten dengan min/max stock di Master Data.
9. **Export** sheet Consumption Details untuk laporan tim pembelian.

---

## 5. Catatan Teknis (sumber data & pembaruan)

- Konsumsi = total qty transaksi **keluar** (`type='out'`) dalam 30/90/180/365 hari; transaksi `status IN ('voided','reversed')` dikeluarkan dari seasonal.
- `lead_time_days` = **COUNT DISTINCT DATE(created_at)** pemakaian per material — proksi siklus pemakaian, bukan lead time pengiriman supplier.
- Setiap membuka halaman, backend menghitung ulang dan **menyimpan** ke `consumption_metrics` (period `monthly`, upsert per material + gudang + hari) termasuk `consumption_trend` (▲/▼/→) vs kemarin & rata-rata 7 hari.
- Z default **1.65 = service level 95%**; dapat diubah di kartu ROP untuk perhitungan real-time.
- Akses dibatasi permission `view_dashboard`, scope sesuai gudang user.

---

## 6. Lihat Juga

- `docs/guide-material-analysis.md` — analisis pergerakan stok per material (dead stock, stockout risk, ITR, tren harga)
- `docs/guide-instalasi-server.md` — instalasi & konfigurasi server

---

_© 2026 Thermaltrue — update terakhir: v1.0.4._