![Logo](admin/webuntis.png)
# ioBroker.webuntis

[![NPM version](https://img.shields.io/npm/v/iobroker.webuntis.svg)](https://www.npmjs.com/package/iobroker.webuntis)
[![Downloads](https://img.shields.io/npm/dm/iobroker.webuntis.svg)](https://www.npmjs.com/package/iobroker.webuntis)
![Number of Installations](https://iobroker.live/badges/webuntis-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/webuntis-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.webuntis.png?downloads=true)](https://nodei.co/npm/iobroker.webuntis/)

**Tests:** ![Test and Release](https://github.com/HJS72/ioBroker.webuntis/workflows/Test%20and%20Release/badge.svg)

## webuntis adapter for ioBroker

Adapter to get data from WebUntis

Dieser Adapter bezieht Daten aus Webuntis. 
Für eine deutsche Anleitung [hier klicken](readme/readme.de.md)

## Donation
[![](https://www.paypalobjects.com/de_DE/DE/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=L55UBQJKJEUJL)

## Getting started
After the install of the adapter in iobroker, automatically opens the Configuration-Window.

Now go to https://webuntis.com and take the schoolname in the searchfield.

![webuntis_start](readme/img/webuntis_start.png)

now you need to strings from the internet-adress of the schoolwebsite from webuntis:
- the base-url 
- the school-secret

see the example below the previous screenshot: [here](https://hepta.webuntis.com/WebUntis/?school=hbs-F%C3%BCrth#/basic/login)

- hepta.webuntis.com    => the schoolbase-URL
- hbs-F%C3%BCrth        => the school-secret

The school base URL accepts either the hostname (for example `hepta.webuntis.com`)
or the full HTTPS WebUntis login URL. Enter the school secret separately.

**If in school-secret is a __+__ , then you must replace this character with a blank space**

now go to the configuration-window in iobroker

![webuntis_config](readme/img/webuntis_config.png)

after the insert of your Username (child or parent) and the password for this account, you can take 
the school-secret and the school-basr-Url to the configuration.

Save to start polling. Each adapter instance uses one account or anonymous
class. For another child, create a second WebUntis instance in ioBroker Admin
and configure its school and login separately.
This version requires js-controller 3.0 or later and Admin 4.0.10 or later for
automatic encryption and decryption of configuration.
Passwords are stored in ioBroker's encrypted native configuration. Keep access to
ioBroker Admin and backups restricted because they contain children's information.

Each instance's `accounts.primary.timetable` state contains JSON with `startDate`, `endDate`
and the WebUntis `lessons` array for the current local Monday through Friday.
The states `accounts.primary.montag`, `.dienstag`, `.mittwoch`, `.donnerstag`
and `.freitag` each contain JSON with `date` and that day's `lessons`, sorted
by start time. Days without lessons have an empty array.
Individual states are available at `timetable.<day>.<lesson>`,
for example `webuntis.0.timetable.montag.1.START`. Lessons are numbered
from 1 in start-time order. Each has `START` and `END` (`HH:MM`), `FACH`,
`ORT`, `LEHRER`, `STATUS`, `INFO` and `VERTRETUNG`. Each day has `DATUM`
and `ANZAHL` states. Multiple subjects, rooms or teachers are comma-separated.
The legacy `0` and `1` daily timetable branches are removed when the instance
starts. Old adapter-created username timetable branches are removed after a
successful refresh; unrelated objects are retained.
Dates and lesson fields come from WebUntis. The `connection` and `lastUpdated`
states indicate whether the last refresh succeeded and when data was last updated.
On failure the last successful timetable remains available; check `connection`
and `lastUpdated` before using it. Polling retries hourly. Inbox and news states
remain available for the configured account. Previously
configured additional accounts are no longer polled. Their old encrypted
configuration and states may remain; legacy credentials stay protected, and old
states can be removed manually if no longer needed.

Login and timetable access depend on school permissions and WebUntis API
compatibility. Parent accounts only return the timetable exposed by WebUntis for
that account; use individual student logins when needed.

please feel free, to make a proposal for recommend versions.

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### 0.3.4 (2022-05-08)
* change log-level for error messages

### 0.3.3 (2022-04-03)
* Add errorhandling for timetable

### 0.3.2 (2022-03-02)
* Add errorhandling for inbox & mesage center

### 0.3.1 (2022-01-30)
* Bug fixes in timetable

### 0.3.0 (2022-01-29)
* Add Inbox peview data

### 0.2.0 (2022-01-27)
* Add anonymous login

### 0.1.0 (2022-01-25)
* Add nextDay
* Add code element

### 0.0.1 (2022-01-25)
* (Newan) initial release

## License
MIT License

Copyright (c) 2022 Newan <info@newan.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.