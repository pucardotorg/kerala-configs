import csv
import requests
import logging
import time

# Logger setup for better debugging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

# File data to be processed (can easily add more files as needed)
file_data = [
    {"filename": "missing_translations_in_en_IN.csv", "lang": "en_IN"},
    # {'filename': 'ml_uat.csv', 'lang': 'ml_IN'}
]

# API headers and authorization
LOCALIZATION_HEADERS = {
    "Content-Type": "application/json",
    "Authorization": "Bearer ed8499ca-58dc-404e-b5ec-4fa2d88a69ec",
}


# Function to make the localization API call
def upsert_localization_data(loc_data):
    loc_url = "https://oncourts.kerala.gov.in/localization/messages/v1/_upsert"
    try:
        response = requests.post(loc_url, headers=LOCALIZATION_HEADERS, json=loc_data)
        response.raise_for_status()  # Will raise an HTTPError for bad responses (4xx, 5xx)
        return response
    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error occurred: {http_err}")
    except Exception as err:
        logging.error(f"Other error occurred: {err}")
    return None


# Process each file and handle its translations
def process_file(file_module, auth_token):
    try:
        with open(file_module["filename"], mode="r", encoding="utf-8") as file:
            csv_reader = csv.reader(file)
            for index, row in enumerate(csv_reader):
                if index == 0:
                    continue  # Skip header row
                print(row)
                mal = row[1]
                # Skip if translation is marked as "-" or "NA"
                if mal == "-" or mal == "NA":
                    logging.info(
                        f"Skipping missing translation at index {index} for code {row[0]}"
                    )
                    continue

                # Prepare the localization data for the API call
                if row[0] and mal:
                    loc_data = {
                        "RequestInfo": {"authToken": auth_token},
                        "tenantId": "kl",
                        "messages": [
                            {
                                "code": row[0],
                                "message": row[1],
                                "module": row[2],
                                "locale": file_module["lang"],
                            }
                        ],
                    }

                    # Make API request to upsert localization data
                    logging.info(f"Upserting translation for code {row[0]}")
                    response = upsert_localization_data(loc_data)

                    if response is None or response.status_code != 200:
                        logging.error(
                            f"Failed to upsert data for code {row[0]}. Status code: {response.status_code}"
                        )
                        logging.error(
                            f"Error response: {response.json() if response else 'No response'}"
                        )
                        break

                    logging.info(f"Successfully upserted translation for code {row[0]}")

    except Exception as e:
        logging.error(f"Error processing file {file_module['filename']}: {e}")


# Main function to process all files
def process_localizations(auth_token):
    for file_module in file_data:
        logging.info(
            f"Processing file {file_module['filename']} for language {file_module['lang']}"
        )
        process_file(file_module, auth_token)


if __name__ == "__main__":
    auth_token = "07e79acf-8bfb-4d5f-a293-bb3ac0e6ee49"
    process_localizations(auth_token)
