botqr
├── Procfile
├── README.md
├── banner.png
├── package-lock.json
├── package.json
├── service-account-key.json
├── src
│   ├── commands
│   │   ├── admin
│   │   │   ├── cancel.js
│   │   │   ├── capital.js
│   │   │   ├── confirm.js
│   │   │   ├── daily.js
│   │   │   ├── info.js
│   │   │   ├── list.js
│   │   │   ├── pay.js
│   │   │   └── remove.js
│   │   ├── qr
│   │   │   ├── removeqr.js
│   │   │   └── setqr.js
│   │   └── user
│   │       ├── my-history.js
│   │       └── top.js
│   ├── config
│   │   └── index.js
│   ├── events
│   │   ├── interactionCreate.js
│   │   └── ready.js
│   ├── handlers
│   │   └── commandLoader.js
│   ├── index.js
│   ├── services
│   │   ├── googleSheets.js
│   │   ├── logger.js
│   │   ├── paymentService.js
│   │   └── qrDataService.js
│   └── utils
│       ├── capitalUtils.js
│       └── embedUtils.js
└── tree.md