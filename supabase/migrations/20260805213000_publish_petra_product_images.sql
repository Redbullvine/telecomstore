-- Publish Petra CSV product images with reversible restrictions.
-- Generated from a private local CSV. No supplier SKU, cost, quantity, MAP,
-- MSRP, account data, or other confidential supplier field is embedded here.

begin;

create table if not exists public.product_image_restrictions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  brand text,
  supplier_sku text,
  reason text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_image_restrictions_one_target_check check (
    num_nonnulls(product_id, brand, supplier_sku) = 1
  ),
  constraint product_image_restrictions_brand_not_blank_check check (brand is null or btrim(brand) <> ''),
  constraint product_image_restrictions_supplier_sku_not_blank_check check (supplier_sku is null or btrim(supplier_sku) <> '')
);

alter table public.product_image_restrictions enable row level security;
revoke all on table public.product_image_restrictions from public, anon;
grant select, insert, update, delete on table public.product_image_restrictions to authenticated;

drop policy if exists "Approved inventory users can read product image restrictions" on public.product_image_restrictions;
create policy "Approved inventory users can read product image restrictions"
on public.product_image_restrictions for select to authenticated
using (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can insert product image restrictions" on public.product_image_restrictions;
create policy "Approved inventory users can insert product image restrictions"
on public.product_image_restrictions for insert to authenticated
with check (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can update product image restrictions" on public.product_image_restrictions;
create policy "Approved inventory users can update product image restrictions"
on public.product_image_restrictions for update to authenticated
using (public.is_approved_inventory_user()) with check (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can delete product image restrictions" on public.product_image_restrictions;
create policy "Approved inventory users can delete product image restrictions"
on public.product_image_restrictions for delete to authenticated
using (public.is_approved_inventory_user());

create index if not exists product_image_restrictions_product_idx
  on public.product_image_restrictions(product_id) where active and product_id is not null;
create index if not exists product_image_restrictions_brand_idx
  on public.product_image_restrictions(lower(brand)) where active and brand is not null;
create index if not exists product_image_restrictions_supplier_sku_idx
  on public.product_image_restrictions(lower(supplier_sku)) where active and supplier_sku is not null;

drop trigger if exists set_product_image_restrictions_updated_at
  on public.product_image_restrictions;
create trigger set_product_image_restrictions_updated_at
before update on public.product_image_restrictions
for each row execute function public.set_updated_at();

create temp table petra_image_seed (
  public_sku text primary key,
  manufacturer_mpn text not null,
  gtin text not null,
  public_url text not null,
  alt_text text not null
) on commit drop;

insert into petra_image_seed (public_sku, manufacturer_mpn, gtin, public_url, alt_text) values
  ('C4-CJM', 'C4-CJM', '853748001095', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ADIC4CJM.jpg', 'Antennas Direct Clearstream 4 Outdoor Antenna (C4-CJM) product image'),
  ('C4-V-CJM', 'C4-V-CJM', '817848011118', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ADIC4VCJM.jpg', 'Antennas Direct Ind/outdr Hdtv Ant/mnt (C4-V-CJM) product image'),
  ('C5', 'C5', '853748001354', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ADIC5.jpg', 'Antennas Direct Clearstream 5 Dtv Antenna (C5) product image'),
  ('CJMOUNT', 'CJMOUNT', '853748001392', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ADICJMOUNT.jpg', 'Antennas Direct Antenna Mount (CJMOUNT) product image'),
  ('DB8-E', 'DB8-E', '817848011620', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ADIDB8E.jpg', 'Antennas Direct DB8E Bowtie UHF Antenna (DB8-E) product image'),
  ('MAST40', 'MAST40', '817848012542', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ANTDMAST40.jpg', 'Antennas Direct 40IN ClearStream Universal Mast (MAST40) product image'),
  ('BK350', 'BK350', '731304016298', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/APCBK350.jpg', 'APC Back-UPS CS 350 VA Tower (BK350) product image'),
  ('BE550G', 'BE550G', '731304258940', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/APNBE550G.jpg', 'APC 550VA 8-OUT Back-ups Es (BE550G) product image'),
  ('BE650G1', 'BE650G1', '731304285434', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/APNBE650G1.jpg', 'APC Back-UPS 650 VA Battery Backup (BE650G1) product image'),
  ('BK500', 'BK500', '731304016304', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/APNBK500.jpg', 'APC Back-ups 500 System (BK500) product image'),
  ('BR1500MS2', 'BR1500MS2', '731304426103', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/APNBR1500MS2.jpg', 'APC Back-UPS Pro 1500 VA Tower with 10 AC Outlets and 2 USB Ports (BR1500MS2) product image'),
  ('BX1000M', 'BX1000M', '731304331766', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/APNBX1000M.jpg', 'APC 1000VA 8-OUT Back Ups Pro (BX1000M) product image'),
  ('BX850M', 'BX850M', '731304331797', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/APNBX850M.jpg', 'APC 850VA 8-OUT Back Ups Pro (BX850M) product image'),
  ('ATCRL32102', 'ATCRL32102', '650530024269', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ATTATCRL32102.jpg', 'At&t DECT Big Button Cordless Das (ATCRL32102) product image'),
  ('P300', 'P300', '759599765936', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/CLAP300.jpg', 'Clarity Amplified Photo Phone (P300) product image'),
  ('52703', '52703', '017229135543', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/CLAR52703.jpg', 'Clarity Expandable Handset (52703) product image'),
  ('53712', '53712', '017229134959', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/CLAR53712.jpg', 'Clarity Amp Cordless Phone W/dig Answr (53712) product image'),
  ('53714', '53714', '017229134874', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/CLAR53714.jpg', 'Clarity D714 40DB Ampd Cordless Phone (53714) product image'),
  ('54505.001', '54505.001', '017229139855', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/CLAR545051.jpg', 'Clarity Alto Plus Amp Corded Phone (54505.001) product image'),
  ('59865.001', '59865.001', '859365007267', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/CLAR598651.jpg', 'Clarity XLC8 DECT 6.0 50 dB Amplified Cordless Phone System (59865.001) product image'),
  ('59234.001', '59234.001', '017229154612', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/CLARXLC34PLUS.jpg', 'Clarity DECT 6.0 50 dB Amplified Cordless Phone with Big Buttons (59234.001) product image'),
  ('CP1500AVRLCD3', 'CP1500AVRLCD3', '649532933570', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/CYBCP1500AVRLCD3.jpg', 'Cyberpower Intelligent Lcd Ups (CP1500AVRLCD3) product image'),
  ('45-0001-UWH', '45-0001-UWH', '660559018002', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/DCM450001WH.jpg', 'Datacomm Electronics Uwhite 1 Gang Recessed (45-0001-UWH) product image'),
  ('50-3321-WH-KIT', '50-3321-WH-KIT', '660559007983', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/DCM503321WHKIT.jpg', 'Datacomm Electronics Flat Panel Cable Org Rem Kit (50-3321-WH-KIT) product image'),
  ('50-3323-WH-KIT', '50-3323-WH-KIT', '660559007990', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/DCM503323WHKIT.jpg', 'Datacomm Electronics Recessed Pair Power Kit (50-3323-WH-KIT) product image'),
  ('50-6623-WH-KIT', '50-6623-WH-KIT', '660559010167', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/DCM506623WHKIT.jpg', 'Datacomm Electronics Flat Panel Cable Org Dup Power (50-6623-WH-KIT) product image'),
  ('500256', '500256', '601430002567', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/EASDISTAMP25GX.jpg', 'Eagle Aspen 25 Db Distribution Amp (500256) product image'),
  ('DTV2BUHF', 'DTV2BUHF', '601430111719', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/EASDTV2BUHF.jpg', 'Eagle Aspen 2-BAY UHF Outdoor Antenna (DTV2BUHF) product image'),
  ('500302', '500302', '601430003021', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/EASP10002AP.jpg', 'Eagle Aspen 2-WAY 1000 MHz Splitter (500302) product image'),
  ('500303', '500303', '601430003038', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/EASP1003AP.jpg', 'Eagle Aspen 3WAY All Port Power Splittr (500303) product image'),
  ('500308', '500308', '601430003083', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/EASP7002.jpg', 'Eagle Aspen 2-WAY Splitter (500308) product image'),
  ('500312', '500312', '601430003120', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/EASP7004AP.jpg', 'Eagle Aspen 4-WAY Splitter (500312) product image'),
  ('EIS3-1004-WHT', 'EIS3-1004-WHT', '805106871925', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ENRGSMTSURGE.jpg', 'Energizer Connect 6OT Smart Surge Protector (EIS3-1004-WHT) product image'),
  ('AS-HP-5R', 'AS-HP-5R', '086429378531', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ETHASHP5R.jpg', 'Helios 5OUT 2USB Surge Wall Tap (AS-HP-5R) product image'),
  ('CS-1X4HDMSPL5', 'CS-1X4HDMSPL5', '086429377459', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ETHCS1X4HDSPL5.jpg', 'Ethereal 1IN/4OUT HDMI Splitter (CS-1X4HDMSPL5) product image'),
  ('CS-C5DE', 'CS-C5DE', '086429373420', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ETHCSC5DE.jpg', 'Ethereal CAT5/6 Digital Aud Extension (CS-C5DE) product image'),
  ('CS-DAC2', 'CS-DAC2', '086429400027', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ETHCSDAC2.jpg', 'Ethereal Toslink/opt Spdif Converter (CS-DAC2) product image'),
  ('CS-HDEXT4KPOEU', 'CS-HDEXT4KPOEU', '086429419722', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ETHCSHDEXT4K.jpg', 'Ethereal 4K Extender Cat6 Black (CS-HDEXT4KPOEU) product image'),
  ('MHX-LHDME12', 'MHX-LHDME12', '086429344826', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ETHMHXLHDME12.jpg', 'Ethereal 12M HDMI Cable 10.2G (MHX-LHDME12) product image'),
  ('MHX-LHDME2', 'MHX-LHDME2', '086429344758', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ETHMHXLHDME2.jpg', 'Ethereal 2M HDMI Cable 18G (MHX-LHDME2) product image'),
  ('MHX-LHDME4', 'MHX-LHDME4', '086429344772', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ETHMHXLHDME4.jpg', 'Ethereal 4M HDMI Cable 18G (MHX-LHDME4) product image'),
  ('MHX-T15', 'MHX-T15', '086429387946', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/ETHMHXT15.jpg', 'Ethereal MHX Series TOSLINK Digital Optical Audio Cable, 15 m (MHX-T15) product image'),
  ('UHF-04M-S1234', 'UHF-04M-S1234', '747705003072', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/GCIUHF04MS1234.jpg', 'Gemini UHF-04M Wireless Prof System (UHF-04M-S1234) product image'),
  ('30-495', '30-495', '783250787494', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI30495.jpg', 'Ideal Mod Plug Crimp Tool (30-495) product image'),
  ('31-340', '31-340', '783250313402', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI31340.jpg', 'Ideal Powr-Fish Heavy-Duty Pull Line, 6,500 ft (31-340) product image'),
  ('33-396', '33-396', '783250714490', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI33396.jpg', 'Ideal RJ45/RJ11 Crimp Tool Kit (33-396) product image'),
  ('33-507', '33-507', '783250801220', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI33507.jpg', 'Ideal RJ45 Trmnation Hip Kit (33-507) product image'),
  ('35-088', '35-088', '783250350889', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI35088.jpg', 'Ideal Electr Scissors With Notch (35-088) product image'),
  ('45-121', '45-121', '783250451210', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI45121.jpg', 'Ideal T-Stripper Wire Stripper for 14–24 Solid and 16–26 Stranded Wire (45-121) product image'),
  ('45-915', '45-915', '783250550197', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI45915.jpg', 'Ideal Kinetic Reflex T-Stripper Wire Stripper (45-915) product image'),
  ('62-200', '62-200', '783250622009', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI62200.jpg', 'Ideal Linkmaster Ethernet (62-200) product image'),
  ('85-366', '85-366', '783250853663', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI85366.jpg', 'Ideal Cat6 RJ45 Plug 25/CD (85-366) product image'),
  ('85-368', '85-368', '783250853687', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI85368.jpg', 'Ideal 25PK CAT6/5 Mod Plug (85-368) product image'),
  ('85-369', '85-369', '783250853694', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI85369.jpg', 'Ideal 50PK CAT6/5 Mod Plug (85-369) product image'),
  ('85-371', '85-371', '783250853717', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI85371.jpg', 'Ideal 50PK Cat5e RJ45 Plugs (85-371) product image'),
  ('85-372', '85-372', '783250853724', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI85372.jpg', 'Ideal 100PK Cat5e RJ45 Plugs (85-372) product image'),
  ('85-376', '85-376', '783250853762', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI85376.jpg', 'Ideal 50PK Cat6 RJ45 Plugs (85-376) product image'),
  ('85-377', '85-377', '783250853779', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI85377.jpg', 'Ideal 100PK Cat6 RJ45 Plugs (85-377) product image'),
  ('86-396', '86-396', '783250863969', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI86396.jpg', 'Ideal RJ45 Mod Plug Bag Of 100 (86-396) product image'),
  ('89-5047', '89-5047', '783250689408', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/IDI895047.jpg', 'Ideal RG59 BNC Compression (89-5047) product image'),
  ('DPS-1100 USB', 'DPS-1100 USB', '099053053279', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/KBZDPS100USB.jpg', 'Koblenz Desk Charging Station (DPS-1100 USB) product image'),
  ('KRA-22M', 'KRA-22M', '019048134912', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/KWBRKRA22M.jpg', 'Kenwood UHF Antenna (KRA-22M) product image'),
  ('KRA-23M', 'KRA-23M', '019048134943', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/KWBRKRA23M.jpg', 'Kenwood VHF Antenna (KRA-23M) product image'),
  ('56-200', '56-200', '792136562001', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/LSD56200.jpg', 'Labor Saving Devices Decoil-zit (56-200) product image'),
  ('81-000', '81-000', '792136810003', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/LSD81000.jpg', 'Labor Saving Devices Creepzit Pro 36FT Kit (81-000) product image'),
  ('81-130', '81-130', '792136811307', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/LSD81130.jpg', 'Labor Saving Devices Creep-zit Wire Running Kit (81-130) product image'),
  ('81-230', '81-230', '792136812304', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/LSD81230.jpg', 'Labor Saving Devices Connector Wire Rod Kit (81-230) product image'),
  ('81-600', '81-600', '792136816005', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/LSD81600.jpg', 'Labor Saving Devices Creepzit Compact 24FT Kit (81-600) product image'),
  ('81-700', '81-700', '792136817002', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/LSD81700.jpg', 'Labor Saving Devices Royrods Wire Running Kit (81-700) product image'),
  ('82-110', '82-110', '792136821108', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/LSD82110.jpg', 'Labor Saving Devices Grabbit Mini 10 ft Pole (82-110) product image'),
  ('82-118', '82-118', '792136821184', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/LSD82118.jpg', 'Labor Saving Devices 18 ft Grabbit Pole (82-118) product image'),
  ('82-350', '82-350', '792136823508', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/LSD82350.jpg', 'Labor Saving Devices Grabbit Ztip Adapter (82-350) product image'),
  ('85-124', '85-124', '792136851242', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/LSD85124.jpg', 'Labor Saving Devices Wet Noodle & Retriever (85-124) product image'),
  ('33202', '33202', '686140332029', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/NCC33202.jpg', 'Stanley 4OUT Surgequad USB Surge (33202) product image'),
  ('910-1001', '910-1001', '666365009876', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/NNUK9101001.jpg', 'Nanuk 910 Case W/foam Black (910-1001) product image'),
  ('925S-060BK-0A0', '925S-060BK-0A0', '666365029904', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/NNUK925S060BK.jpg', 'Nanuk 925 Cam Case W/org Dividr (925S-060BK-0A0) product image'),
  ('963-1001', '963-1001', '666365023957', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/NNUK9631001.jpg', 'Nanuk Case 963 With Foam Black (963-1001) product image'),
  ('965-1001', '965-1001', '666365023971', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/NNUK9651001.jpg', 'Nanuk Case 965 With Foam Black (965-1001) product image'),
  ('PB802105', 'PB802105', '054732807482', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/PRIPB802105.jpg', 'Prime 1OUT 900J Surge Tap (PB802105) product image'),
  ('PBRUSB346S-A', 'PBRUSB346S-A', '054732826537', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/PRIPBRUSB346S.jpg', 'Prime 6OUT 1200J Surge Tap (PBRUSB346S-A) product image'),
  ('PCBLCO102', 'PCBLCO102', '842893106717', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/PYLPCBLCO102.jpg', 'Pyle Cable Protector Ramp with Flip-Open Access Lid (PCBLCO102) product image'),
  ('PDWM2145', 'PDWM2145', '068888758321', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/PYLPDWM2145.jpg', 'Pyle Fixed Freq Wireless Mic System (PDWM2145) product image'),
  ('PDWM3375', 'PDWM3375', '068888744409', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/PYLPDWM3375.jpg', 'Pyle 2CH Wireless Mic System (PDWM3375) product image'),
  ('PDWM3400', 'PDWM3400', '068888744416', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/PYLPDWM3400.jpg', 'Pyle Premier Wireless Mic System (PDWM3400) product image'),
  ('PDBC70', 'PDBC70', '068888743822', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/PYRPDBC70.jpg', 'Pyle 9O 15A Power Switch Control (PDBC70) product image'),
  ('PDWM4120', 'PDWM4120', '842893119755', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/PYRPDWM4120.jpg', 'Pyle H&o UHF Wireless Mic System (PDWM4120) product image'),
  ('AMP1450E', 'AMP1450E', '044476061011', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAAMP1450F.jpg', 'RCA Digi Amp For Indoor Antna (AMP1450E) product image'),
  ('ANT111E', 'ANT111E', '079000334835', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAANT111.jpg', 'RCA Indoor Passive Antenna (ANT111E) product image'),
  ('ANT1560E1', 'ANT1560E1', '044476125652', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAANT1560E1.jpg', 'RCA Amplified Indoor Flat Multi-Directional HDTV Antenna (ANT1560E1) product image'),
  ('ANT310E', 'ANT310E', '044476121845', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAANT310F.jpg', 'RCA Amplified Indoor Antna (ANT310E) product image'),
  ('ANT705E', 'ANT705E', '044476128677', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAANT705E.jpg', 'RCA Attic/outdoor Hdtv Antenna (ANT705E) product image'),
  ('ANT754E', 'ANT754E', '044476151132', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAANT754E.jpg', 'RCA Antenna Outdoor Attic Compa (ANT754E) product image'),
  ('DH12HHE', 'DH12HHE', '044476042553', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCADH12HHR.jpg', 'RCA 12FT Dig Plus HDMI 2 HDMI (DH12HHE) product image'),
  ('DH24SPE', 'DH24SPE', '044476043024', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCADH24SPR.jpg', 'RCA 2.4GHZ 2WAY Digital Splitter (DH24SPE) product image'),
  ('DH3HHE', 'DH3HHE', '044476042539', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCADH3HHR.jpg', 'RCA 3FT HDMI Cable (DH3HHE) product image'),
  ('DH6HHE', 'DH6HHE', '044476042546', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCADH6HHR.jpg', 'RCA 6FT Dig Plus HDMI To HDMI (DH6HHE) product image'),
  ('DV10RV', 'DV10RV', '079000316152', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCADV10RV.jpg', 'RCA 6FT Optical Cable Black (DV10RV) product image'),
  ('TP210WHRV', 'TP210WHRV', '044476065408', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATP210WHRV.jpg', 'RCA 7FT Mod Phone Cord White (TP210WHRV) product image'),
  ('TP231WHR', 'TP231WHR', '044476053245', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATP231WHR.jpg', 'RCA 15FT Phone Line Cord White (TP231WHR) product image'),
  ('TP243WHR', 'TP243WHR', '044476053252', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATP243WHR.jpg', 'RCA 25FT Phone Line Cord White (TP243WHR) product image'),
  ('TP257WHR', 'TP257WHR', '079000308614', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATP257WHR.jpg', 'RCA Duplex Mod Jack White (TP257WHR) product image'),
  ('TP265WHR', 'TP265WHR', '044476060557', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATP265WHR.jpg', 'RCA Surf Mount Phone Jack White (TP265WHR) product image'),
  ('TP280WRV', 'TP280WRV', '079000404194', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATP280WRV.jpg', 'RCA 12FT Phone Coil Cord White (TP280WRV) product image'),
  ('TP282AR', 'TP282AR', '079000404200', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATP282AR.jpg', 'RCA 25FT Phone Coil Cord Ivr (TP282AR) product image'),
  ('TP282BLRV', 'TP282BLRV', '079000404224', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATP282BLRV.jpg', 'RCA Standard Handset Coil Cord, 25 ft, Black (TP282BLRV) product image'),
  ('TP282WR', 'TP282WR', '079000404255', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATP282WR.jpg', 'RCA 25FT Handset Coil Cord With (TP282WR) product image'),
  ('TP443WHRV', 'TP443WHRV', '044476053085', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATP443WHRV.jpg', 'RCA 50FT Mod Phone Cord White (TP443WHRV) product image'),
  ('TPH530BR', 'TPH530BR', '044476061424', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATPH530BR.jpg', 'RCA 7 ft Cat5e Cable Blu (TPH530BR) product image'),
  ('TPH532BR', 'TPH532BR', '044476048258', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATPH532BR.jpg', 'RCA 25FT Cat5e 100MHZ Cable Blu (TPH532BR) product image'),
  ('TPH560R1V', 'TPH560R1V', '044476138997', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATPH560R1V.jpg', 'RCA CAT5E/6 in Line Coupler With (TPH560R1V) product image'),
  ('TPH633R', 'TPH633R', '044476071959', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCATPH633R.jpg', 'RCA 50FT Cat 6 Cable Black (TPH633R) product image'),
  ('VH125R', 'VH125R', '044476060779', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVH125R.jpg', 'RCA 4IN Antenna Wall Mount Kit (VH125R) product image'),
  ('VH47R', 'VH47R', '079000403364', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVH47R.jpg', 'RCA Two-way Splitter (VH47R) product image'),
  ('VH603RV1', 'VH603RV1', '079000320586', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVH603RV1.jpg', 'RCA 3FT RG6 Cable Black (VH603RV1) product image'),
  ('VH606R', 'VH606R', '079000320593', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVH606R.jpg', 'RCA 6FT RG6 Coax Cable Black (VH606R) product image'),
  ('VH606WHR', 'VH606WHR', '079000320630', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVH606WHRV1.jpg', 'RCA 6FT RG6 Cable White (VH606WHR) product image'),
  ('VH612R', 'VH612R', '079000320609', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVH612R.jpg', 'RCA 12FT RG6 Coax Cable Black (VH612R) product image'),
  ('VH625RV', 'VH625RV', '079000320616', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVH625R.jpg', 'RCA 25FT RG6 Coax Cable Black (VH625RV) product image'),
  ('VH66R1', 'VH66R1', '079000403463', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVH66R.jpg', 'RCA Coax Cable Feed Connector (VH66R1) product image'),
  ('VHB6111R', 'VHB6111R', '079000316114', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVHB6111R.jpg', 'RCA 100FT RG6 Coax Cable Black (VHB6111R) product image'),
  ('VHB655R', 'VHB655R', '079000316091', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVHB655R.jpg', 'RCA 50FT RG6 Coax Cable Black (VHB655R) product image'),
  ('VHEXT8E', 'VHEXT8E', '044476138027', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVHEXT8E.jpg', 'RCA Coax Extension Cable (VHEXT8E) product image'),
  ('VHFC015E', 'VHFC015E', '044476138393', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/RCAVHFC015E.jpg', 'RCA Flat Coax Extnsn Cable (VHFC015E) product image'),
  ('C380N', 'C380N', '884945009096', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/SGEC380N.jpg', 'Eco4life 4O Smart Surge Power Strip W/usb (C380N) product image'),
  ('84-213', '84-213', '076174842135', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/STY84213.jpg', 'Stanley Wire Stripper & Cutter (84-213) product image'),
  ('AHD10-04290', 'AHD10-04290', '846788042906', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTAHD1004290.jpg', 'Vericom 10FT HDMI 30AWG Black (AHD10-04290) product image'),
  ('AHD30-04293', 'AHD30-04293', '846788042937', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTAHD3004293.jpg', 'Vericom 30FT HDMI 28AWG Black (AHD30-04293) product image'),
  ('AHD50-04294', 'AHD50-04294', '846788042944', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTAHD5004294.jpg', 'Vericom 50FT HDMI 24AWG Black (AHD50-04294) product image'),
  ('MBW5U-00932', 'MBW5U-00932', '846788009329', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTMBW5U00932.jpg', 'Vericom CAT 5e U/UTP Solid Riser CMR Cable, 1,000 ft, Blue (MBW5U-00932) product image'),
  ('MBW5U-01440', 'MBW5U-01440', '846788014408', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTMBW5U01440.jpg', 'Vericom CAT 5e U/UTP Solid Riser CMR Cable, 1,000 ft, Black (MBW5U-01440) product image'),
  ('MBW5U-01441', 'MBW5U-01441', '846788014415', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTMBW5U01441.jpg', 'Vericom CAT 5e U/UTP Solid Riser CMR Cable, 1,000 ft, White (MBW5U-01441) product image'),
  ('MBW5U-01443', 'MBW5U-01443', '846788014439', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTMBW5U01443.jpg', 'Vericom CAT 5e U/UTP Solid Riser CMR Cable, 1,000 ft, Yellow (MBW5U-01443) product image'),
  ('MBW5U-01554', 'MBW5U-01554', '846788015542', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTMBW5U01554.jpg', 'Vericom CAT 5e U/UTP Solid Riser CMR Cable, 1,000 ft, Red (MBW5U-01554) product image'),
  ('MBW6U-00934', 'MBW6U-00934', '846788009343', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTMBW6U00934.jpg', 'Vericom CAT 6 U/UTP Solid Riser CMR Cable, 1,000 ft, Blue (MBW6U-00934) product image'),
  ('MBW6U-01444', 'MBW6U-01444', '846788014446', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTMBW6U01444.jpg', 'Vericom CAT 6 U/UTP Solid Riser CMR Cable, 1,000 ft, White (MBW6U-01444) product image'),
  ('MBW6U-01445', 'MBW6U-01445', '846788014453', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTMBW6U01445.jpg', 'Vericom CAT 6 U/UTP Solid Riser CMR Cable, 1,000 ft, Yellow (MBW6U-01445) product image'),
  ('MKJ6U-01352', 'MKJ6U-01352', '846788013524', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTMKJ6U01352.jpg', 'Vericom Kest Coupler Cat6 Unshld Black (MKJ6U-01352) product image'),
  ('WTCXC-03634', 'WTCXC-03634', '846788036349', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTWTCXC03634.jpg', 'Vericom Coax Hex Crimp Tool (WTCXC-03634) product image'),
  ('WTCXS-03631', 'WTCXS-03631', '846788036318', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTWTCXS03631.jpg', 'Vericom Universal Coax Strip Tool (WTCXS-03631) product image'),
  ('WTRJC-03632', 'WTRJC-03632', '846788036325', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTWTRJC03632.jpg', 'Vericom Modular Crimp/strip Tool (WTRJC-03632) product image'),
  ('XHD03-04252', 'XHD03-04252', '846788042524', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTXHD0104252.jpg', 'Vericom 3FT HDMI Cable With Ethernet Black (XHD03-04252) product image'),
  ('XHD01-04253', 'XHD01-04253', '846788042531', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTXHD0104253.jpg', 'Vericom 6FT HDMI Cable With Ethernet Black (XHD01-04253) product image'),
  ('XHD01-04254', 'XHD01-04254', '846788042548', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTXHD0104254.jpg', 'Vericom 10FT HDMI Cable With Ethernet Black (XHD01-04254) product image'),
  ('XHD01-04255', 'XHD01-04255', '846788042555', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTXHD0104255.jpg', 'Vericom 12FT HDMI Cable With Ethernet Black (XHD01-04255) product image'),
  ('XHD01-04260', 'XHD01-04260', '846788042609', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTXHD0104260.jpg', 'Vericom 12FT HDMI Cable With Ethernet White (XHD01-04260) product image'),
  ('XRG06-02404', 'XRG06-02404', '846788024049', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TCTXRG0602404.jpg', 'Vericom 1000FT RG6 Dual Shield Cable (XRG06-02404) product image'),
  ('TLP1008TELTV', 'TLP1008TELTV', '037332119070', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRP1008TELP.jpg', 'Tripp Lite by Eaton 10 Outlet Surge (TLP1008TELTV) product image'),
  ('TLP1208TELTV', 'TLP1208TELTV', '037332152510', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRP1208TELTV.jpg', 'Tripp Lite by Eaton 12OUT Surge With Coax/tel (TLP1208TELTV) product image'),
  ('A102-02M', 'A102-02M', '037332121912', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPA10202M.jpg', 'Tripp Lite by Eaton 6FT Digital Optical Cable (A102-02M) product image'),
  ('A102-04M', 'A102-04M', '037332121929', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPA10204M.jpg', 'Tripp Lite by Eaton 13FT Digital Optical Cable (A102-04M) product image'),
  ('AVR750UNC', 'AVR750UNC', '037332281135', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPAVR750UNC.jpg', 'Tripp Lite by Eaton 12O 750VA 450W Li Cloud Ups (AVR750UNC) product image'),
  ('B118-008E-UHD-2', 'B118-008E-UHD-2', '037332239907', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPB118008EUHD2.jpg', 'Tripp Lite by Eaton 8PRT 4K HDMI Splitter (B118-008E-UHD-2) product image'),
  ('BC600RNC', 'BC600RNC', '037332283504', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPBC600RNC.jpg', 'Tripp Lite by Eaton Cloud-Connected 600 VA/300 W Desktop UPS with 4 AC Outlets (BC600RNC) product image'),
  ('ISOBAR6 ULTRA', 'ISOBAR6 ULTRA', '037332010544', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPISOBAR6ULT.jpg', 'Tripp Lite by Eaton 6 Out Surge With 6FT Cord (ISOBAR6 ULTRA) product image'),
  ('LC1200', 'LC1200', '037332040022', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPLC1200.jpg', 'Tripp Lite by Eaton 1200W 120V Line Conditioner (LC1200) product image'),
  ('LC2400', 'LC2400', '037332040060', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPLC2400.jpg', 'Tripp Lite by Eaton 2400W 120V Power Conditioner (LC2400) product image'),
  ('N001-025-BK', 'N001-025-BK', '037332042644', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPN001025BK.jpg', 'Tripp Lite by Eaton Cat5e 350MHZ Cable 25 ft (N001-025-BK) product image'),
  ('N001-050-BK', 'N001-050-BK', '037332042743', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPN001050BK.jpg', 'Tripp Lite by Eaton Cat5e Patch Cable 50 ft (N001-050-BK) product image'),
  ('N032-001', 'N032-001', '037332013149', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPN032001.jpg', 'Tripp Lite by Eaton Cat5e RJ45 Inline Couplr (N032-001) product image'),
  ('N201-007-BL', 'N201-007-BL', '037332099884', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPN201007BL.jpg', 'Tripp Lite by Eaton CAT 6 Gigabit Snagless Stranded UTP Ethernet Cable, 7 ft, Blue (N201-007-BL) product image'),
  ('N201-007-WH', 'N201-007-WH', '037332125149', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPN201007WH.jpg', 'Tripp Lite by Eaton 7FT Cat6 Gigabit Snagless (N201-007-WH) product image'),
  ('N201-014-BL', 'N201-014-BL', '037332099945', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPN201014BL.jpg', 'Tripp Lite by Eaton CAT 6 Gigabit Snagless Solid UTP Ethernet Cable, 14 ft, Blue (N201-014-BL) product image'),
  ('N201-025-BL', 'N201-025-BL', '037332099983', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPN201025BL.jpg', 'Tripp Lite by Eaton CAT 6 Gigabit Snagless Solid UTP Ethernet Cable, 25 ft, Blue (N201-025-BL) product image'),
  ('N201-050-BL', 'N201-050-BL', '037332173041', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPN201050BL.jpg', 'Tripp Lite by Eaton CAT 6 Gigabit Snagless Solid UTP Ethernet Cable, 50 ft, Blue (N201-050-BL) product image'),
  ('N201-100-BL', 'N201-100-BL', '037332173102', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPN201100BL.jpg', 'Tripp Lite by Eaton CAT 6 Gigabit Snagless Solid UTP Ethernet Cable, 100 ft, Blue (N201-100-BL) product image'),
  ('N201-015-BL', 'N201-015-BL', '037332172976', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPN20115BL.jpg', 'Tripp Lite by Eaton 15FT Cat6 Snagless RJ45 Cable (N201-015-BL) product image'),
  ('P131-06N', 'P131-06N', '037332180261', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPP13106N.jpg', 'Tripp Lite by Eaton Hdmi/vga With Audio Converter (P131-06N) product image'),
  ('P502-006', 'P502-006', '037332012319', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPP502006.jpg', 'Tripp Lite by Eaton Svga Monitor Cable 6F- (P502-006) product image'),
  ('P569-006-MF', 'P569-006-MF', '037332191571', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPP569006MF.jpg', 'Tripp Lite by Eaton 4K HDMI Extension Cable With Ethernet (P569-006-MF) product image'),
  ('P570-006-MICRO', 'P570-006-MICRO', '037332165503', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPP570006MC.jpg', 'Tripp Lite by Eaton HDMI To Microhdmi Cable 6FT (P570-006-MICRO) product image'),
  ('SMART1200XLHG', 'SMART1200XLHG', '037332116406', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPSMART1200XLHG.jpg', 'Tripp Lite by Eaton 4O 120V 1KVA 750W Med Ups (SMART1200XLHG) product image'),
  ('SMART1500LCD', 'SMART1500LCD', '037332126146', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPSMART1500.jpg', 'Tripp Lite by Eaton 1500VA Lcd Ups (SMART1500LCD) product image'),
  ('SPIKECUBE', 'SPIKECUBE', '037332010643', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPSPIKECUBE.jpg', 'Tripp Lite by Eaton 1OUT 600J Spikecube Surge (SPIKECUBE) product image'),
  ('SUPER7', 'SUPER7', '037332095282', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPSUPER7.jpg', 'Tripp Lite by Eaton 7 Outlet Surge Protector (SUPER7) product image'),
  ('SUPER725B', 'SUPER725B', '037332189844', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPSUPER725B.jpg', 'Tripp Lite by Eaton 25FT 7OUT 2160J Surge (SUPER725B) product image'),
  ('SUPER7B', 'SUPER7B', '037332175168', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPSUPER7B.jpg', 'Tripp Lite by Eaton 7-OTLT Surge Protector 2160 Joules (SUPER7B) product image'),
  ('SWIVEL6USB', 'SWIVEL6USB', '037332210944', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPSWIVEL6USB.jpg', 'Tripp Lite by Eaton 6OUT Direct Plug Surge (SWIVEL6USB) product image'),
  ('TLM609SA', 'TLM609SA', '037332140098', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLM609SA.jpg', 'Tripp Lite by Eaton 9FT 6O Protect It Surge (TLM609SA) product image'),
  ('TLM615SA', 'TLM615SA', '037332140081', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLM615SA.jpg', 'Tripp Lite by Eaton 15FT 6O Protect It Surge (TLM615SA) product image'),
  ('TLP1006B', 'TLP1006B', '037332200013', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP1006B.jpg', 'Tripp Lite by Eaton 6FT 10OUT 2880J Surge Black (TLP1006B) product image'),
  ('TLP1208SAT', 'TLP1208SAT', '037332175182', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP1208SAT.jpg', 'Tripp Lite by Eaton 12OUT Protect It Surge (TLP1208SAT) product image'),
  ('TLP1208TEL', 'TLP1208TEL', '037332152503', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP1208TEL.jpg', 'Tripp Lite by Eaton 8FT 12OUT 2160J Surge (TLP1208TEL) product image'),
  ('TLP128TTUSBB', 'TLP128TTUSBB', '037332209788', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP128USBB.jpg', 'Tripp Lite by Eaton 12OUT 8FT Plastic Surge (TLP128TTUSBB) product image'),
  ('TLP310USBC', 'TLP310USBC', '037332198464', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP310USBC.jpg', 'Tripp Lite by Eaton 10FT 510J 3OUT Surge Black (TLP310USBC) product image'),
  ('TLP4BK', 'TLP4BK', '037332138392', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP4BK.jpg', 'Tripp Lite by Eaton 4OUT 720J Surge Black (TLP4BK) product image'),
  ('TLP604', 'TLP604', '037332100498', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP604.jpg', 'Tripp Lite by Eaton 6 Out Surge Protector 4FT Cord (TLP604) product image'),
  ('TLP606DMUSB', 'TLP606DMUSB', '037332180292', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP606DMUSB.jpg', 'Tripp Lite by Eaton 6-OTLT Surge W/clamps (TLP606DMUSB) product image'),
  ('TLP610U30CLAMPB', 'TLP610U30CLAMPB', '037332290564', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP610U30CL.jpg', 'Tripp Lite by Eaton Protect It Desk Clamp Surge Protector with 6 AC Outlets and 2 USB Ports, 10 ft (TLP610U30CLAMPB) product image'),
  ('TLP648USBC', 'TLP648USBC', '037332231130', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP648USBC.jpg', 'Tripp Lite by Eaton 6OUT 8FT Desk Clamp Surge (TLP648USBC) product image'),
  ('TLP6B', 'TLP6B', '037332166784', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP6B.jpg', 'Tripp Lite by Eaton 6 Out Surge Protector 6FT Cord (TLP6B) product image'),
  ('TLP74RB', 'TLP74RB', '037332155665', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP74RB.jpg', 'Tripp Lite by Eaton 7OUTLT Surge Protectr (TLP74RB) product image'),
  ('TLP76MSG', 'TLP76MSG', '037332166074', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP76MSG.jpg', 'Tripp Lite by Eaton 7 Out Surge Protector 6FT Cord (TLP76MSG) product image'),
  ('TLP76MSGB', 'TLP76MSGB', '037332205810', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP76MSGB.jpg', 'Tripp Lite by Eaton 6FT 7OUT 1080J Surge Black (TLP76MSGB) product image'),
  ('TLP808B', 'TLP808B', '037332189837', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP808B.jpg', 'Tripp Lite by Eaton 8FT 8OUT 1440J Surge Black (TLP808B) product image'),
  ('TLP810NET', 'TLP810NET', '037332095329', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP810NET.jpg', 'Tripp Lite by Eaton 8 Outlet + Phone Lan (TLP810NET) product image'),
  ('TLP864USBB', 'TLP864USBB', '037332223654', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP864USBB.jpg', 'Tripp Lite by Eaton 8OUT 6FT Plastic Surge (TLP864USBB) product image'),
  ('TLP88TUSBB', 'TLP88TUSBB', '037332223579', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPTLP88TUSBB.jpg', 'Tripp Lite by Eaton 8OUT 8FT Plastic Surge (TLP88TUSBB) product image'),
  ('U236-000-R', 'U236-000-R', '037332163127', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPU236000R.jpg', 'Tripp Lite by Eaton USB 2 Ethernet Adapter (U236-000-R) product image'),
  ('U436-06N-GBW', 'U436-06N-GBW', '037332189240', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TRPU43606NGBW.jpg', 'Tripp Lite by Eaton USB3.1 GEN1C Ethernet Adapter (U436-06N-GBW) product image'),
  ('DS6101', 'DS6101', '735078017475', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/VTEDS6101.jpg', 'Vtech Add Handset: VTEDS6151 (DS6101) product image'),
  ('DS6151', 'DS6151', '735078016584', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/VTEDS6151.jpg', 'Vtech DECT 6.0 2-Line Cordless Phone (DS6151) product image'),
  ('FL-1000', 'FL-1000', '615798402747', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/WGDFL1000.jpg', 'Winegard FL-1000 Indoor HD Antenna (FL-1000) product image'),
  ('HD8200U', 'HD8200U', '615798398491', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/WGDHD8200U.jpg', 'Winegard Hdtv Antenna Deep Fringe (HD8200U) product image'),
  ('TB-0005', 'TB-0005', '615798101589', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/WGDTB0005.jpg', 'Winegard 5FT Swedged Masting (TB-0005) product image'),
  ('WM-2040', 'WM-2040', '615798399207', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/WGDWM2040.jpg', 'Winegard 4IN Galvanized Wall Mount (WM-2040) product image'),
  ('314475', '314475', '811815022558', 'https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/WSN314475.jpg', 'Wilson Electronics 75OHM Wdebnd Directional Antna (314475) product image');

do $$
declare matched_count integer;
begin
  select count(*) into matched_count
  from petra_image_seed s
  where exists (
    select 1 from public.products p
    where p.sku = s.public_sku
      and lower(p.manufacturer_mpn) = lower(s.manufacturer_mpn)
      and p.gtin = s.gtin
  );
  if matched_count not in (0, 206) then
    raise exception 'Petra image seed requires either an empty disposable catalog or all 206 exact SKU/MPN/GTIN matches; found %', matched_count;
  end if;
end $$;

insert into public.product_images (
  product_id, url, source_type, source_url, alt_text, sort_order,
  is_primary, publishable, rights_status, image_type
)
select
  p.id,
  s.public_url,
  'supplier',
  s.public_url,
  s.alt_text,
  0,
  not exists (select 1 from public.product_images current where current.product_id = p.id and current.is_primary),
  true,
  'approved',
  'item'
from petra_image_seed s
join public.products p
  on p.sku = s.public_sku
 and lower(p.manufacturer_mpn) = lower(s.manufacturer_mpn)
 and p.gtin = s.gtin
where not exists (
  select 1 from public.product_images existing
  where existing.product_id = p.id and existing.url = s.public_url
);

create or replace function public.get_public_product_catalog()
returns table (
  id uuid, sku text, brand text, title text, category text, condition text,
  public_availability text, price numeric, currency_code text,
  public_price_note text, short_description text, long_description text,
  photo_main text, photo_label text, photo_extra_1 text, photo_extra_2 text,
  slug text, manufacturer_mpn text, gtin text, specifications jsonb,
  meta_title text, meta_description text, search_keywords text[],
  google_product_category text, canonical_url_override text,
  published_at timestamptz, updated_at timestamptz, status text
)
language sql stable security definer set search_path = pg_catalog
as $$
  select
    p.id, p.sku, p.brand, p.title, p.category, p.condition,
    case when p.quantity_available > 0 then 'in_stock'
         when p.quantity_available = 0 then 'out_of_stock'
         else 'quote_only' end,
    p.price, p.currency_code, case when p.price is null then 'Request quote' end,
    p.short_description, p.long_description,
    case when image_restriction.blocked is true then null else coalesce(public_image.url, p.photo_main) end,
    p.photo_label, p.photo_extra_1, p.photo_extra_2,
    p.slug, p.manufacturer_mpn, p.gtin, p.specifications,
    p.meta_title, p.meta_description, p.search_keywords,
    p.google_product_category, p.canonical_url_override,
    p.published_at, p.updated_at, p.status
  from public.products p
  left join lateral (
    select true as blocked
    from public.product_image_restrictions r
    where r.active is true
      and (
        r.product_id = p.id
        or (r.brand is not null and lower(r.brand) = lower(p.brand))
        or (r.supplier_sku is not null and exists (
          select 1
          from public.product_supplier_offers offer
          join public.supplier_products sp on sp.id = offer.supplier_product_id
          where offer.product_id = p.id
            and lower(sp.supplier_sku) = lower(r.supplier_sku)
        ))
      )
    limit 1
  ) image_restriction on true
  left join lateral (
    select pi.url
    from public.product_images pi
    where pi.product_id = p.id
      and pi.publishable is true
      and pi.rights_status = 'approved'
      and image_restriction.blocked is null
    order by pi.is_primary desc, pi.sort_order, pi.created_at
    limit 1
  ) public_image on true
  where p.status = 'available'
  order by p.updated_at desc nulls last;
$$;

revoke all on function public.get_public_product_catalog() from public;
grant execute on function public.get_public_product_catalog() to anon, authenticated;

comment on table public.product_image_restrictions is
  'Protected reversible controls for suppressing supplier images by product, brand, or private supplier SKU.';
comment on function public.get_public_product_catalog() is
  'Public-safe storefront projection with approved product images and protected restriction filtering.';

commit;
