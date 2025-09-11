"""
CSV to YAML Converter for Test Case Data

This script converts CSV files containing test case data into structured YAML format
suitable for the Language Model Comparison App. The converter handles test case
metadata, utterances, and notional specification outputs.

Usage:
    python csv-to-yaml-converter.py

Author: Research Team
"""

import pandas as pd
import yaml
import json

def convert_csv_to_yaml(csv_path: str, yaml_output_path: str) -> str:
    """
    Convert a CSV file containing test case data to structured YAML format.
    
    The CSV should contain columns for test case metadata, utterances, and
    notional specification outputs. The converter groups utterances by test
    case number and handles JSON parsing of notional specifications.
    
    Args:
        csv_path (str): Path to the input CSV file
        yaml_output_path (str): Path where the output YAML file will be saved
        
    Returns:
        str: Path to the generated YAML file
        
    Raises:
        FileNotFoundError: If the input CSV file doesn't exist
        json.JSONDecodeError: If notional-spec-out contains invalid JSON
    """
    # Load CSV data into pandas DataFrame
    df = pd.read_csv(csv_path)

    # Dictionary to store test cases grouped by test number
    test_cases = {}
    
    # Process each row in the CSV
    for index, row in df.iterrows():
        # Extract test number, using row index as fallback
        test_number = int(row["test-number"]) if "test-number" in df.columns and pd.notna(row["test-number"]) else index
        
        # Create new test case entry if this test number hasn't been seen
        if test_number not in test_cases:
            test_cases[test_number] = {
                "test-number": test_number,
                "description": row["description"] if "description" in df.columns and pd.notna(row["description"]) else "...",
                "requirement-id": row["requirement-id"] if "requirement-id" in df.columns and pd.notna(row["requirement-id"]) else "...",
                "utterances": []
            }

        # Parse notional specification output safely
        # Handle cases where JSON parsing might fail
        notional_spec = {}
        if "notional-spec-out" in df.columns and pd.notna(row["notional-spec-out"]):
            try:
                notional_spec = json.loads(row["notional-spec-out"])
            except json.JSONDecodeError as e:
                print(f"Warning: Invalid JSON in row {index}: {e}")
                notional_spec = {}

        # Create utterance entry with all available data
        utterance = {
            "canonical": row["canonical"] if "canonical" in df.columns and pd.notna(row["canonical"]) else "",
            "paraphrase": [row["paraphrase"]] if "paraphrase" in df.columns and pd.notna(row["paraphrase"]) else [],
            "labels": [row["tags"]] if "tags" in df.columns and pd.notna(row["tags"]) else [],  
            "notional-spec-out": notional_spec,
        }

        # Add utterance to the appropriate test case
        test_cases[test_number]["utterances"].append(utterance)

    # Convert test cases dictionary to YAML format
    # Use list of values to maintain order and structure
    yaml_output = yaml.dump(list(test_cases.values()), sort_keys=False, default_flow_style=False, allow_unicode=True)
    
    # Write YAML output to file
    with open(yaml_output_path, "w") as yaml_file:
        yaml_file.write(yaml_output)

    print(f"YAML file saved to {yaml_output_path}")
    return yaml_output_path