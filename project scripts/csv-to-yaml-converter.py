import pandas as pd
import yaml
import json

# Converts a CSV file to a structured YAML format where:
def convert_csv_to_yaml(csv_path, yaml_output_path):
    df = pd.read_csv(csv_path)

    test_cases = {}
    
    for index, row in df.iterrows():
        test_number = int(row["test-number"]) if "test-number" in df.columns and pd.notna(row["test-number"]) else index
        
        if test_number not in test_cases:
            test_cases[test_number] = {
                "test-number": test_number,
                "description": row["description"] if "description" in df.columns and pd.notna(row["description"]) else "...",
                "requirement-id": row["requirement-id"] if "requirement-id" in df.columns and pd.notna(row["requirement-id"]) else "...",
                "utterances": []
            }

        # Parse notional-spec-out safely, logging errors if JSON parsing fails
        notional_spec = {}
        if "notional-spec-out" in df.columns and pd.notna(row["notional-spec-out"]):
            try:
                notional_spec = json.loads(row["notional-spec-out"])
            except json.JSONDecodeError as e:
                print(f"Warning: Invalid JSON in row {index}: {e}")
                notional_spec = {}

        # Create utterance entry
        utterance = {
            "canonical": row["canonical"] if "canonical" in df.columns and pd.notna(row["canonical"]) else "",
            "paraphrase": [row["paraphrase"]] if "paraphrase" in df.columns and pd.notna(row["paraphrase"]) else [],
            "labels": [row["tags"]] if "tags" in df.columns and pd.notna(row["tags"]) else [],  
            "notional-spec-out": notional_spec,
        }

        test_cases[test_number]["utterances"].append(utterance)

    # Convert to YAML format
    yaml_output = yaml.dump(list(test_cases.values()), sort_keys=False, default_flow_style=False, allow_unicode=True)
    
    with open(yaml_output_path, "w") as yaml_file:
        yaml_file.write(yaml_output)

    print(f"YAML file saved to {yaml_output_path}")
    return yaml_output_path