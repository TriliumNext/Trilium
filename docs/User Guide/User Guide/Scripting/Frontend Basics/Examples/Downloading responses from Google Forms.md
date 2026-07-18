# Downloading responses from Google Forms
This tutorial showcases a basic integration with Google Forms, where we are able to download the responses of a form using the “Link to Sheets" functionality.

Note that the link will be publicly accessible to everyone (however the link is in a hard-to-guess format such as `https://docs.google.com/spreadsheets/d/e/2PACX-1vTA8NU2_eZFhc8TFadCZPreBfvP7un8IHd6J0SchrLLw3ueGmntNZjwRmsH2ZRcp1pJYDAzMz1FmFaj/pub?output=csv`). Make sure you are not accidentally publishing sensitive information.

## Obtaining the CSV link

1.  Open the Google Forms in a browser.
2.  Select the “Responses” tab and click on “Link to Sheets”.
3.  Select “Create a new spreadsheet” and press “Create”.
4.  In Google Sheets, select File → Share → Publish to web.
5.  In the “Publish to the web” screen, make sure the “Link” tab is selected and instead of “Web page”, select “Comma-separated values (.csv)”.
6.  Copy the given link which will be used for the upcoming script.

## Creating the script

Create a “JS Frontend” script:

```
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTiwooLV2whjCSVa49dJ99p_G3_qhqHHRqttMjYCJVfLXVdTgUSNJu5K0rpqmaHYF2k7Vofi3o7gW82/pub?output=csv";

async function fetchData() {
    try {
        const response = await fetch(CSV_URL);
        return await response.text();
    } catch (e) {
        api.showError(e.message);
    }
}

const data = await fetchData();
console.log(data);
// Do something with the data.
```

Note that the data will be received as a string and there is no library to do the CSV parsing for us. To do a very simple parsing of CSV:

```
const content = data
	.split("\n")
	.slice(1)
	.map((row) => row.split(","));
```

This will return the data as an array of arrays.