import yaml
import pandas as pd

# Function to parse the YAML file and extract required fields
def parse_yaml_to_table(file_path):
    with open(file_path, 'r') as file:
        parsed_test_cases = yaml.safe_load(file)
    
    all_rows = []
    for test_case in parsed_test_cases:
        test_number = test_case.get("test-number", None)
        description = test_case.get("description", "")
        requirement_id = test_case.get("requirement-id", "")
        for utterance in test_case.get("utterances", []):
            row = {
                "Test Case Number": test_number,
                "Description": description,
                "Requirement ID": requirement_id,
                "Labels": ", ".join(utterance.get("labels", [])),
                "Canonical Utterance": utterance.get("canonical", ""),
                "Paraphrase Utterance": ", ".join(utterance.get("paraphrase", [])),
                "Notional Spec Out": yaml.dump(utterance.get("notional-spec-out", {})),
            }
            all_rows.append(row)
    
    # Convert to DataFrame
    return pd.DataFrame(all_rows)

# Specify the YAML file path
file_path = "/Users/srishti.palani/Desktop/LM-Eval/lm-comparison-app/backend/data/test_cases/strange-goodall-tc.v2.yaml"

# Parse the file and create the table
parsed_table = parse_yaml_to_table(file_path)

# Save or display the table as needed
parsed_table.to_csv("parsed_test_cases.csv", index=False)  # Save as CSV
print(parsed_table)  # Print to console
