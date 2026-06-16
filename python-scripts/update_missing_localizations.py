import csv
import requests
import logging
import argparse

# Logger setup for better debugging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

# env list we need to update the localization
env_list = [
    {
        "env": "dev",
        "url": "dristi-kerala-dev.pucar.org",
        "password": "Beehyv@123",
        "username": "mdmsv2Super",
    },
    {
        "env": "qa",
        "url": "dristi-kerala-qa.pucar.org",
        "password": "Beehyv@123",
        "username": "mdmsv2Qa",
    },
    {
        "env": "demo",
        "url": "demo.pucar.org",
        "password": "Beehyv@123",
        "username": "mdmsv2Demo",
    },
    {
        "env": "uat",
        "url": "oncourts-staging.kerala.gov.in",
        "password": "Beehyv@123",
        "username": "workbenchuser",
    },
    {
        "env": "prod",
        "url": "oncourts.kerala.gov.in",
        "password": "oN24*7@56",
        "username": "On247loc",
    },
]

# File data to be processed (can easily add more files as needed)
file_data = [
    {"filename": "missing_translations_in_en_IN.csv", "lang": "en_IN"},
    # {"filename": "missing_translations_in_ml_IN.csv", "lang": "ml_IN"},
]

# API headers for OAuth token request
AUTH_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/x-www-form-urlencoded",
    "authorization": "Basic ZWdvdi11c2VyLWNsaWVudDo=",
}

LOCALIZATION_HEADERS = {
    "Content-Type": "application/json",
}


def get_auth_token(env):
    """
    Fetches an OAuth access token for the given environment.
    """
    url = f"https://{env['url']}/user/oauth/token"
    data = {
        "userType": "EMPLOYEE",
        "tenantId": "kl",
        "scope": "read",
        "grant_type": "password",
        "username": env["username"],
        "password": env["password"],
    }
    try:
        response = requests.post(url, headers=AUTH_HEADERS, data=data, verify=False)
        response.raise_for_status()
        token = response.json()["access_token"]
        logging.info(f"Auth token fetched for {env['url']}")
        return token
    except Exception as e:
        logging.error(f"Failed to get auth token for {env['url']}: {e}")
        return None


# Function to make the localization API call
def upsert_localization_data(env, loc_data):
    loc_url = f"https://{env['url']}/localization/messages/v1/_upsert"
    try:
        response = requests.post(loc_url, headers=LOCALIZATION_HEADERS, json=loc_data, verify=False)
        response.raise_for_status()
        return response
    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error occurred: {http_err}")
    except Exception as err:
        logging.error(f"Other error occurred: {err}")
    return None


# Process each file and handle its translations
def process_file(file_module, env):
    try:
        with open(file_module["filename"], mode="r", encoding="utf-8") as file:
            csv_reader = csv.reader(file)
            for index, row in enumerate(csv_reader):
                if index == 0:
                    continue  # Skip header row

                msg = row[1]
                # Skip if translation is marked as "-" or "NA"
                if msg == "-" or msg == "NA":
                    logging.info(
                        f"Skipping missing translation at index {index} for code {row[0]}"
                    )
                    continue

                # Prepare the localization data for the API call
                if row[0] and msg:
                    loc_data = {
                        "RequestInfo": {"authToken": env["token"]},
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
                    logging.info(f"Upserting translation for code {row[0]} on {env['url']}")
                    response = upsert_localization_data(env, loc_data)

                    if response is None or response.status_code != 200:
                        status = response.status_code if response else 'No response'
                        logging.error(
                            f"Failed to upsert data for code {row[0]}. Status: {status}"
                        )
                        break

                    logging.info(f"Successfully upserted translation for code {row[0]}")

    except Exception as e:
        logging.error(f"Error processing file {file_module['filename']}: {e}")


# Main function to process all files across all environments
def process_localizations(selected_envs=None):
    targets = env_list
    if selected_envs:
        targets = [e for e in env_list if e["env"] in selected_envs]
        if not targets:
            logging.error(f"No matching environments found for: {selected_envs}")
            logging.info(f"Available envs: {[e['env'] for e in env_list]}")
            return

    for env in targets:
        logging.info(f"--- Processing environment: {env['env']} ({env['url']}) ---")
        token = get_auth_token(env)
        if not token:
            logging.error(f"Skipping environment {env['url']} due to auth failure")
            continue
        env["token"] = token

        for file_module in file_data:
            logging.info(
                f"Processing file {file_module['filename']} for language {file_module['lang']}"
            )
            process_file(file_module, env)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Update missing localizations across environments")
    parser.add_argument(
        "--envs",
        type=lambda s: [e.strip() for e in s.split(",")],
        metavar="ENV",
        help="Comma-separated list of environments to update (e.g. dev,qa,uat). "
             f"Available: {[e['env'] for e in env_list]}",
        required=True,
    )
    args = parser.parse_args()
    process_localizations(selected_envs=args.envs)
