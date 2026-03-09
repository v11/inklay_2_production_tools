# Factory Device Provisioning

Helper tooling to register factory devices in Firebase RTDB (`factoryDevices/<hardware_id>`).

## Getting Started

### 1) Clone / download project

```bash
git clone <repo-url>
cd inklay_2_production_tools/factory_device_provisioning
```

### 2) Install dependencies

```bash
npm install
```

### 3) Add service account JSON files

Place Firebase admin service account files in:

```text
factory_device_provisioning/service_accounts/
```

Example beta file already used by this project:

```text
inklay-2-beta-firebase-adminsdk-fbsvc-3f1143e230.json
```

### 4) Configure environments

Create/update these two files:

- `.env.beta`
- `.env.production`

Both files must include:

```env
DEVICE_SECRET_PEPPER=...
FIREBASE_DB_URL=https://<your-rtdb-url>
SERVICE_ACCOUNT_FILENAME=<service-account-file.json>
```

### 5) Select target environment

```bash
npm run use:beta
# or
npm run use:prod
```

This copies `.env.beta` or `.env.production` to `.env` (the runtime config used by `factory_device_provisioning.js`).

## Manual Use

The `factory_device_provisioning.js` helper script can manually add a device to the `factoryDevices` database.

```bash
node factory_device_provisioning.js \
  --manual \
  --hardware_id "00:00:00:00:00:00" \
  --claim_code "2S5ui0ZQ6liE7O0rf1EX5g=="
```

## Semi-Automatic Use (Serial)

The `factory_device_provisioning.js` helper script can listen to serial logs and add a device automatically.

### 1) Build and flash firmware

```bash
idf.py build flash
```

### 2) Set target environment for provisioning tool

```bash
npm run use:beta
# or
npm run use:prod
```

### 3) Start provisioning listener

```bash
node factory_device_provisioning.js \
  --serial /dev/tty.usbmodem101 \
  --baud 115200
```

### 4) Boot Inklay in factory provisioning startup mode

Press `Button 3 + Button 1`.

When serial output contains `FACTORY ...`, the tool registers the device in Firebase.

Example output:

```text
Registered: 00:00:00:00:00:00
```

## Switch Environment

### Show current runtime environment

```bash
cat .env
```

### Switch to beta

```bash
npm run use:beta
```

### Switch to production

```bash
npm run use:prod
```

### Validate selected Firebase target

```bash
grep -E '^(FIREBASE_DB_URL|SERVICE_ACCOUNT_FILENAME)=' .env
```
